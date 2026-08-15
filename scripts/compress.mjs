/* =========================================================
   compress.mjs — reduce project media to the smallest size
   WITHOUT losing visible quality.

   Images  -> WebP  (lossless-to-visually-lossless, auto)
              Written NEXT TO the original (.webp sibling).
   Videos  -> WebM  (VP9, 2-pass CRF, auto bitrate)
              Written NEXT TO the original (.webm sibling).

   Requirements:
     - Node 18+
     - npm i sharp        (image encoding)
     - ffmpeg on PATH     (video encoding, tested on v7.1)
     - ffprobe on PATH    (reads source video properties)

   Usage:
     node scripts/compress.mjs                  # whole project
     node scripts/compress.mjs --only-images    # skip videos
     node scripts/compress.mjs --only-videos    # skip images
     node scripts/compress.mjs --dry-run        # list only
   ========================================================= */

import { lstatSync } from "node:fs";
import { readdir as readdirProm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/* ---------------------------------------------------------
   Configuration
   --------------------------------------------------------- */
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".jfif"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".m4v", ".mkv", ".webm"]);
const SKIP_DIRS = new Set(["node_modules", ".git"]);

// Files already in the target format are treated as "done" and
// are NOT re-encoded (prevents recompressing outputs on re-runs).
const TARGET_IMAGE_EXT = ".webp";
const TARGET_VIDEO_EXT = ".webm";

// WebP quality ceiling — tune down further if you want smaller files.
const WEBP_QUALITY = 82;
const WEBP_METHOD = 6;         // 0..6, higher = smaller + slower
const WEBP_ALPHA_Q = 100;
const WEBP_MIN_SIZE = 320;     // never shrink below this on the long edge
const WEBP_MAX_EDGE = 4096;    // capped output long edge (see note below)

// VP9 (WebM) encode settings.
// 2-pass with a target average bitrate -> predictable, small size.
const VP9_MAX_EDGE = 1920;     // cap to 1080p-ish for the web
const VP9_CPU = 4;             // 0..8; higher = slower + smaller

// Target bitrate (kbps) per resolution tier. Aim for smallest size
// with no visible loss on typical loop/architectural content.
function vp9Bitrate(longEdgePx) {
  if (longEdgePx >= 1920) return 1300;   // 1080p
  if (longEdgePx >= 1280) return 800;    // 720p
  if (longEdgePx >= 854)  return 550;    // 480p
  return 350;
}

const args = process.argv.slice(2);
const ONLY_IMAGES = args.includes("--only-images");
const ONLY_VIDEOS = args.includes("--only-videos");
const DRY_RUN = args.includes("--dry-run");

let imageCount = 0;
let videoCount = 0;
let imageOriginal = 0;
let imageNew = 0;
let videoOriginal = 0;
let videoNew = 0;

/* ---------------------------------------------------------
   Walk folders
   --------------------------------------------------------- */
async function walk(dir) {
  let entries;
  try {
    entries = await readdirProm(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      files.push(...(await walk(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

function fmt(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + " GB";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + " MB";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + " KB";
  return n + " B";
}

function pad(s, n) {
  return String(s).padStart(n);
}

function percent(part, whole) {
  if (!whole) return "0%";
  return Math.round((part / whole) * 100) + "%";
}

/* ---------------------------------------------------------
   Images
   --------------------------------------------------------- */
async function encodeImage(src, dest) {
  const info = await sharp(src).metadata();
  let { width, height } = info;
  if (!width || !height) return null;

  // Compute the long edge with a small margin heuristic so we
  // don't upscale or lose perceptible detail.
  let longEdge = Math.max(width, height);
  if (longEdge > WEBP_MAX_EDGE) longEdge = WEBP_MAX_EDGE;
  if (longEdge < WEBP_MIN_SIZE) longEdge = WEBP_MIN_SIZE;

  const isLandscape = width >= height;
  const opts = {
    quality: WEBP_QUALITY,
    method: WEBP_METHOD,
    alphaQuality: WEBP_ALPHA_Q
  };

  let pipeline = sharp(src);

  // Downscale only when a dimension exceeds the target long edge.
  if ((isLandscape && width > longEdge) || (!isLandscape && height > longEdge)) {
    pipeline = pipeline.resize({
      width: isLandscape ? longEdge : undefined,
      height: !isLandscape ? longEdge : undefined,
      withoutEnlargement: true
    });
  }

  await pipeline
    .rotate() // bake EXIF orientation
    .webp(opts)
    .toFile(dest);
}

/* ---------------------------------------------------------
   Videos — VP9 WebM, 2-pass, capped resolution
   --------------------------------------------------------- */
function probeVideo(file) {
  return new Promise((resolve, reject) => {
    execFile(
      "ffprobe",
      [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height,r_frame_rate,nb_frames",
        "-show_entries", "format=duration",
        "-of", "json",
        file
      ],
      (err, stdout) => {
        if (err) return reject(err);
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

async function ffmpeg(argsList) {
  const out = await execFileP("ffmpeg", argsList, { maxBuffer: 128 * 1024 * 1024, windowsHide: true });
  return out;
}

async function encodeVideo(src, dest) {
  const probe = await probeVideo(src);
  const v = probe.streams && probe.streams[0];
  if (!v) return null;
  const width = v.width || 0;
  const height = v.height || 0;

  // Resolution cap: keep aspect, cap the long edge.
  const longEdge = Math.max(width, height);
  let scale = "iw:ih";
  if (longEdge > VP9_MAX_EDGE) {
    const s = VP9_MAX_EDGE / longEdge;
    const nw = Math.round(width * s);
    const nh = Math.round(height * s);
    // keep even (VP9 requirement)
    scale = `${nw % 2 ? nw - 1 : nw}:${nh % 2 ? nh - 1 : nh}`;
  }

  const base = [
    "-y",
    "-i", src,
    "-c:v", "libvpx-vp9",
    "-b:v", vp9Bitrate(longEdge) + "k",
    "-maxrate", (vp9Bitrate(longEdge) * 1.5) + "k",
    "-bufsize", (vp9Bitrate(longEdge) * 2) + "k",
    "-vf", `scale=${scale}`,
    "-row-mt", "1",
    "-tiles", "2x2",
    "-deadline", "good",
    "-cpu-used", String(VP9_CPU),
    "-pix_fmt", "yuv420p",
    "-an" // drop audio (these are loop visuals)
  ];

  // Pass 1 — stats only (writes ffmpeg2pass-0.log in cwd)
  await ffmpeg(base.concat(["-pass", "1", "-f", "null", "-"]));

  // Pass 2 — real encode
  await ffmpeg(base.concat(["-pass", "2", dest]));

  // Validate: the output must be a complete, non-truncated file
  const fs = await import("node:fs");
  if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
    throw new Error("encode produced no output file");
  }
  const check = await probeVideo(dest);
  const dur = Number(check.format && check.format.duration);
  const srcDur = Number(probe.format && probe.format.duration);
  if (isFinite(dur) && isFinite(srcDur) && Math.abs(dur - srcDur) > 1.5) {
    try { fs.unlinkSync(dest); } catch {}
    throw new Error(`truncated output (${dur.toFixed(1)}s vs source ${srcDur.toFixed(1)}s)`);
  }
  const outFrames = Number((check.streams && check.streams[0] && check.streams[0].nb_frames) || 0);
  const srcFrames = Number((v && v.nb_frames) || 0);
  if (srcFrames && outFrames && outFrames < srcFrames * 0.9) {
    try { fs.unlinkSync(dest); } catch {}
    throw new Error(`truncated output (${outFrames}/${srcFrames} frames)`);
  }
}

/* ---------------------------------------------------------
   Main
   --------------------------------------------------------- */
async function main() {
  if (!ONLY_IMAGES && !ONLY_VIDEOS && !DRY_RUN) {
    console.log("Checking sharp …");
    try {
      await sharp(Buffer.from([1])).metadata();
    } catch {
      console.error("Missing dependency. Run:  npm install sharp");
      process.exit(1);
    }
  }

  const roots = ["arch", "concepts"];
  const allFiles = [];
  for (const r of roots) {
    const p = path.join(ROOT, r);
    allFiles.push(...(await walk(p)));
  }

  // Also include loose media sitting at the project root
  // (e.g. videos/mp4 next to the html entry point).
  try {
    const fs = await import("node:fs");
    for (const name of fs.readdirSync(ROOT)) {
      const full = path.join(ROOT, name);
      let st;
      try { st = fs.lstatSync(full); } catch { continue; }
      if (!st.isFile()) continue;
      const ext = path.extname(name).toLowerCase();
      if (IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext)) allFiles.push(full);
    }
  } catch {}

  const images = allFiles.filter((f) =>
    IMAGE_EXTS.has(path.extname(f).toLowerCase()) &&
    path.extname(f).toLowerCase() !== TARGET_IMAGE_EXT
  );
  const videos = allFiles.filter((f) =>
    VIDEO_EXTS.has(path.extname(f).toLowerCase()) &&
    path.extname(f).toLowerCase() !== TARGET_VIDEO_EXT
  );

  console.log("\n=== OPUNTO MEDIA COMPRESSOR ===");
  console.log(`Found: ${images.length} images, ${videos.length} videos\n`);

  // ---- Images ----
  if (!ONLY_VIDEOS) {
    console.log("── Images → WebP ──");
    for (const src of images) {
      const dest = src.replace(/\.[^.]+$/, ".webp");
      const origSize = lstatSync(src).size;
      let newSize = 0;
      if (DRY_RUN) {
        console.log(`  [queue] ${path.relative(ROOT, src)}`);
        imageCount++;
        continue;
      }
      try {
        await encodeImage(src, dest);
        newSize = lstatSync(dest).size;
        imageOriginal += origSize;
        imageNew += newSize;
        imageCount++;
        console.log(
          `  ${pad(fmt(origSize), 10)} -> ${pad(fmt(newSize), 10)} ` +
          `(${pad(percent(newSize, origSize), 4)})  ${path.relative(ROOT, dest)}`
        );
      } catch (e) {
        console.error(`  ✗ ${path.relative(ROOT, src)} — ${e.message}`);
      }
    }
    if (imageCount) {
      console.log(
        `\n  Images: ${imageCount}  ${fmt(imageOriginal)} → ${fmt(imageNew)} ` +
        `(${percent(imageNew, imageOriginal)})\n`
      );
    }
  }

  // ---- Videos ----
  if (!ONLY_IMAGES) {
    console.log("── Videos → WebM ──");
    for (const src of videos) {
      const dest = src.replace(/\.[^.]+$/, ".webm");
      const origSize = lstatSync(src).size;
      if (DRY_RUN) {
        console.log(`  [queue] ${path.relative(ROOT, src)}`);
        videoCount++;
        continue;
      }
      try {
        await encodeVideo(src, dest);
        const newSize = lstatSync(dest).size;
        videoOriginal += origSize;
        videoNew += newSize;
        videoCount++;
        console.log(
          `  ${pad(fmt(origSize), 10)} -> ${pad(fmt(newSize), 10)} ` +
          `(${pad(percent(newSize, origSize), 4)})  ${path.relative(ROOT, dest)}`
        );
      } catch (e) {
        console.error(`  ✗ ${path.relative(ROOT, src)} — ${e.message}`);
      }
    }
    if (videoCount) {
      console.log(
        `\n  Videos: ${videoCount}  ${fmt(videoOriginal)} → ${fmt(videoNew)} ` +
        `(${percent(videoNew, videoOriginal)})\n`
      );
    }
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

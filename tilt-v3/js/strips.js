/* =========================================================
   STRIPS — builds each world's vertical wall.
   Precomputes per-strip parallax multipliers and attaches a
   gsap.quickSetter per animated property, so the per-frame
   ticker does zero allocation and zero property parsing.
   ========================================================= */

(function (NS, gsap) {

    function getMedia(strip) {
        return strip._media;
    }

    function buildStrips(wallEl, src, cacheArr) {
        wallEl.innerHTML = "";
        cacheArr.length = 0;

        const count = NS.stripCount();
        const isList = Array.isArray(src) && src.length > 0;
        const mid = (count - 1) / 2;
        const yBase = NS.isMobile() ? 6 : 10;

        for (let i = 0; i < count; i++) {
            const strip = document.createElement("div");
            strip.className = "strip";

            const media = document.createElement("div");
            media.className = "strip-media";

            const url = isList ? src[i % src.length] : src;
            media.style.backgroundImage = 'url("' + url + '")';
            media.style.backgroundPosition = i % 2 ? "left center" : "right center";

            strip.appendChild(media);

            const offset = i - mid;
            const depth = 1 - Math.abs(offset) / mid;

            // Precomputed parallax multipliers (mouse in -1..1)
            strip._k = {
                x: offset * 22,
                y: yBase * (1 - (Math.abs(offset) / mid) * .6),
                scale: .92 + depth * .14,   // constant depth scale
                mx: -offset * 34,
                my: 18
            };
            strip._media = media;

            // Init the transform cache and apply the constant
            // depth scale once (never changes after build).
            gsap.set(strip, { x: 0, y: 0, scale: strip._k.scale });

            // One quickSetter per animated property (GSAP 3.13).
            strip._sx = gsap.quickSetter(strip, "x", "px");
            strip._sy = gsap.quickSetter(strip, "y", "px");
            media._sx = gsap.quickSetter(media, "x", "px");
            media._sy = gsap.quickSetter(media, "y", "px");

            cacheArr.push(strip);
            wallEl.appendChild(strip);
        }
    }

    // Build the wall from a curated image list, cycling through it
    // deterministically (strip i -> list[i % len]) — no randomness.
    function buildWall(wallEl, images, cacheArr) {
        buildStrips(wallEl, images, cacheArr);
    }

    NS.build = {
        randomWall: buildWall,
        getMedia: getMedia
    };

})(window.OV3, gsap);

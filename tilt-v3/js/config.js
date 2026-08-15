/* =========================================================
   CONFIG — shared constants, state and small helpers.
   Only one global namespace (window.OV3) keeps everything
   cheap and dependency-free between modules.
   ========================================================= */

(function (NS) {

    /* -----------------------------------------------------
       Breakpoints & counts
       ----------------------------------------------------- */
    NS.BP_MOBILE = 800;

    function isMobile() {
        return window.innerWidth <= NS.BP_MOBILE;
    }

    /* -----------------------------------------------------
       PERFORMANCE / BATTERY AWARENESS
       The #1 source of "transition feels like 5 FPS when I'm
       on battery" is GPU throttling: on a discharging battery
       the browser drops the GPU/compositor to a low clock, and
       every extra layer / filter / blend multiplies the cost.

       We expose a single `quality` gate ("max" | "balanced" |
       "low") that every module reads, so heavy work collapses
       automatically when power is scarce:
         - max      : plugged in / normal  -> full 12 strips, vivid reveal
         - balanced : on battery           -> fewer strips, lighter reveal
         - low      : critical battery     -> minimal strips, no parallax
       ----------------------------------------------------- */
    NS.perf = {
        lowPower: false,     // discharging battery
        critical: false,     // level < 20% AND discharging
        quality: "max",      // derived: "max" | "balanced" | "low"
        onChange: null       // callback(cfg) fired when quality changes
    };

    function deriveQuality() {
        var low = NS.perf.lowPower;
        var crit = NS.perf.critical;
        if (crit) return "low";
        if (low) return "balanced";
        return "max";
    }

    NS.perf.apply = function () {
        NS.perf.quality = deriveQuality();
        if (typeof NS.perf.onChange === "function") {
            NS.perf.onChange(NS.perf);
        }
    };

    // Prefer a manual override (for testing) — e.g. in console:
    //   OV3.perf.force = "balanced"; OV3.perf.apply();
    NS.perf.force = null;

    /* Chromium supports navigator.getBattery(); harmless no-op elsewhere. */
    function initBattery() {
        function onBattery(bat) {
            NS.perf.lowPower = !bat.charging;
            NS.perf.critical = !bat.charging && bat.level < 0.2;
            NS.perf.apply();
            if (bat.addEventListener) {
                bat.addEventListener("chargingchange", function () {
                    NS.perf.lowPower = !bat.charging;
                    NS.perf.critical = !bat.charging && bat.level < 0.2;
                    NS.perf.apply();
                });
                bat.addEventListener("levelchange", function () {
                    NS.perf.critical = !bat.charging && bat.level < 0.2;
                    NS.perf.apply();
                });
            }
        }
        if (navigator.getBattery) {
            navigator.getBattery().then(onBattery).catch(function () {});
        }
    }

    function stripCount() {
        // Fewer strips = fewer composited layers = far cheaper on a
        // throttled GPU. 12 -> 8 on battery, 12 -> 6 on critical.
        var q = NS.perf.quality;
        if (isMobile()) {
            if (q === "low") return 4;
            if (q === "balanced") return 5;
            return 6;
        }
        if (q === "low") return 6;
        if (q === "balanced") return 8;
        return 12;
    }

    /* -----------------------------------------------------
       World state
       ----------------------------------------------------- */
    NS.currentWorld = "architecture";   // "architecture" | "concept"
    NS.transitioning = false;

    /* Lightweight FPS watchdog: if the render loop can't hold ~30fps for
       a sustained stretch we degrade automatically, even if the Battery API
       wasn't available (covers OS/browser throttle on battery).
       Called on every frame from the shared ticker; cheap (one perf.now +
       two counters). */
    NS.perf.fps = {
        last: performance.now(),
        slow: 0,
        total: 0,
        degraded: false
    };
    NS.perf.fpsWatch = function () {
        var now = performance.now();
        var dt = now - NS.perf.fps.last;
        NS.perf.fps.last = now;
        if (dt > 1) NS.perf.fps.total++;
        if (dt > 50) NS.perf.fps.slow++;          // < 20fps frame
        if (NS.perf.fps.total >= 120) {           // ~2s window at 60fps
            var ratio = NS.perf.fps.slow / NS.perf.fps.total;
            NS.perf.fps.slow = 0;
            NS.perf.fps.total = 0;
            if (ratio > 0.4 && !NS.perf.force && NS.perf.quality !== "low") {
                NS.perf.force = NS.perf.quality === "max" ? "balanced" : "low";
                NS.perf.apply();
            }
        }
    };

    /* -----------------------------------------------------
       Image manifest — CURATED, hardcoded (no random loading).
       Architecture images: chosen explicitly by the studio.
       Concept images: selected at editorial discretion.
       ----------------------------------------------------- */
    NS.ARCH_IMAGES = [
        "arch/ARCH%20DESIGN/A%20frame/7_edit.webp",
        "arch/ARCH%20DESIGN/Apartament%20Baneasa/image00007.webp",
        "arch/ARCH%20DESIGN/Apartament%20Baneasa/image00067.webp",
        "arch/ARCH%20DESIGN/Apartament%20L1/1.webp",
        "arch/ARCH%20DESIGN/Casa%20Mitza%20Berceni/05.webp",
        "arch/ARCH%20DESIGN/Casa%20Roman%20Cluj/3.webp",
        "arch/ARCH%20DESIGN/Residential/3.webp",
        "arch/ARCH%20DESIGN/IRINA%20TUDORACHE/p1.webp",
        "arch/ARCH%20DESIGN/GT%20Lawyer_s%20Office/21.webp"
    ];

    NS.CONCEPT_IMAGES = [
        "concepts/1.webp",
        "concepts/2.webp",
        "concepts/3.webp",
        "concepts/4.webp",
        "concepts/5.webp",
        "concepts/6.webp",
        "concepts/7.webp",
        "concepts/8.webp",
        "concepts/9.webp"
    ];

    // Public-ish surface used by boot/intro
    NS.isMobile = isMobile;
    NS.stripCount = stripCount;
    NS.initBattery = initBattery;

})((window.OV3 = window.OV3 || {}));

/* =========================================================
   BOOT — wires modules together: refs, wall build, events,
   intro, scroll/click/swipe navigation, videos, shared ticker.
   ========================================================= */

(function (NS, gsap) {

    const $ = (id) => document.getElementById(id);

    /* -----------------------------------------------------
       DOM refs (cached once)
       ----------------------------------------------------- */
    const refs = {
        hero: $("hero"),
        bgShade: $("bgShade"),
        architectureWorld: $("architectureWorld"),
        conceptWorld: $("conceptWorld"),
        architectureSide: $("architectureSide"),
        conceptSide: $("conceptSide"),
        oObject: $("oObject"),
        oShadow: $("oShadow"),
        architectureWall: $("architectureWall"),
        conceptWall: $("conceptWall"),
        progressFill: $("progressFill"),
        cursor: $("cursor"),
        cursorDot: $("cursorDot"),
        siteScroll: $("siteScroll"),
        archVideo: document.querySelector(".architecture-video"),
        conceptVideo: document.querySelector(".concept-video"),
        archStrips: [],
        conceptStrips: []
    };
    refs.archFloor = refs.architectureWorld.querySelector(".floor");
    refs.conceptFloor = refs.conceptWorld.querySelector(".floor");
    NS.refs = refs;

    /* -----------------------------------------------------
       BUILD WALLS (curated hardcoded images, cached strips)
       ----------------------------------------------------- */
    function currentWallUrls(wallEl) {
        const out = [];
        const medias = wallEl.querySelectorAll(".strip-media");
        for (let i = 0; i < medias.length; i++) {
            const m = medias[i].style.backgroundImage || "";
            const m0 = m.match(/url\("?([^")]+)"?\)/);
            if (m0 && m0[1]) out.push(m0[1]);
        }
        return out;
    }

    function warmCurrentImages() {
        NS.preload.imagesNow(currentWallUrls(refs.architectureWall)
            .concat(currentWallUrls(refs.conceptWall)));
    }

    function buildWalls() {
        NS.build.randomWall(refs.architectureWall, NS.ARCH_IMAGES, refs.archStrips);
        NS.build.randomWall(refs.conceptWall, NS.CONCEPT_IMAGES, refs.conceptStrips);
        // The images actually on screen (incl. the hidden world)
        // get preloaded + pre-decoded so the next transition is
        // jank-free; the curated set warms in the bg.
        warmCurrentImages();
        NS.preload.images(NS.ARCH_IMAGES.concat(NS.CONCEPT_IMAGES));
    }

    /* Rebuild wall layers whenever the effective quality changes
       (battery / FPS watchdog) OR we cross the mobile breakpoint. */
    function scheduleRebuild() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
            var nowMobile = NS.isMobile();
            var rebuild = nowMobile !== lastMobile || lastQuality !== NS.perf.quality;
            lastMobile = nowMobile;
            lastQuality = NS.perf.quality;
            if (rebuild) buildWalls();
        }, 150);
    }

    /* ---- quality tracking ---- */
    var lastMobile = NS.isMobile();
    var lastQuality = NS.perf.quality;

    // Battery-aware rebuilds (Chromium).
    NS.perf.onChange = function () {
        scheduleRebuild();
    };
    NS.initBattery();

    var resizeTimer;
    window.addEventListener("resize", scheduleRebuild);

    /* Build the initial walls + activate the initial brand page. */
    buildWalls();
    NS.pages.init();

    /* -----------------------------------------------------
       NAVIGATION
       Scroll down  -> the active brand page
       Scroll up    -> back to the hero
       Left / right -> brand switch (runs in the hero)
       ----------------------------------------------------- */
    let pendingSwitch = null;

    function go(next) {
        if (pendingSwitch || NS.transitioning) return;
        if (refs.siteScroll.scrollTop <= 2) {
            NS.world.changeWorld(next);
        } else {
            pendingSwitch = next;
            refs.siteScroll.scrollTo({ top: 0, behavior: "smooth" });
        }
    }

    refs.architectureSide.addEventListener("click", () => go("architecture"));
    refs.conceptSide.addEventListener("click", () => go("concept"));
    refs.oObject.addEventListener("click", () =>
        go(NS.currentWorld === "architecture" ? "concept" : "architecture"));

    /* Arrow keys — left/right brand switch */
    window.addEventListener("keydown", (e) => {
        if (e.key === "ArrowLeft") { e.preventDefault(); go("architecture"); }
        else if (e.key === "ArrowRight") { e.preventDefault(); go("concept"); }
    });

    /* Touch — horizontal swipe switches brand; vertical stays native scroll */
    let touchStartX = 0;
    let touchStartY = 0;
    window.addEventListener("touchstart", (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }, { passive: true });

    window.addEventListener("touchend", (e) => {
        if (NS.transitioning) return;
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
        go(dx < 0 ? "concept" : "architecture");
    }, { passive: true });

    /* Scroll tracking — hero visibility + fire any pending switch at top */
    NS.inHero = true;
    refs.siteScroll.addEventListener("scroll", () => {
        const top = refs.siteScroll.scrollTop;
        const inHero = top <= 2;
        if (inHero !== NS.inHero) {
            NS.inHero = inHero;
            if (inHero) NS.tilt.reset();
        }
        if (pendingSwitch && inHero) {
            const next = pendingSwitch;
            pendingSwitch = null;
            NS.world.changeWorld(next);
        }
    }, { passive: true });

    /* -----------------------------------------------------
       TILT + CURSOR (single shared GSAP ticker = one RAF)
       ----------------------------------------------------- */
    NS.tilt.configure(refs);
    const cursorTick = NS.cursor.init(refs.cursor, refs.cursorDot);

    // Mobile: drive the hero parallax from the device orientation sensors
    // instead of mouse/drag (pointer input is off when the sensor is live).
    NS.sensor.init();

    // Shared render loop (single RAF). The FPS watchdog runs on the same
    // loop — if the compositor can't hold ~30fps it auto-degrades quality.
    gsap.ticker.add(() => {
        NS.tilt.tick();
        if (cursorTick) cursorTick();
        NS.perf.fpsWatch();
    });

    window.addEventListener("pointermove", (e) => {
        if (NS.sensor.active) return; // sensor owns input on mobile
        NS.tilt.onPointerMove(e);
    }, { passive: true });

    /* -----------------------------------------------------
       INITIAL STATE
       ----------------------------------------------------- */
    gsap.set(refs.conceptWorld, { opacity: 0, zIndex: 2 });
    gsap.set(refs.architectureWorld, { opacity: 1, zIndex: 1 });
    gsap.set(refs.bgShade, { opacity: 0 });
    gsap.set(refs.conceptSide, { opacity: 0, x: 100, y: 0, scale: .96 });
    gsap.set(refs.architectureSide, { opacity: 1, x: 0, y: 0, scale: 1 });
    gsap.set(refs.archVideo, { opacity: 1 });
    gsap.set(refs.conceptVideo, { opacity: 0 });

    /* -----------------------------------------------------
       INTRO
       ----------------------------------------------------- */
    const intro = gsap.timeline();
    intro.from(".nav", { opacity: 0, y: -20, duration: .8, ease: "power3.out" });
    intro.from(refs.architectureSide, { opacity: 0, x: -50, duration: 1, ease: "expo.out" }, "-=.4");
    intro.from(refs.oObject, { opacity: 0, scale: .72, rotationY: -25, duration: 1.3, ease: "expo.out" }, "-=.8");
    intro.from(".center-copy", { opacity: 0, y: 20, duration: .7 }, "-=.5");

    /* -----------------------------------------------------
       VIDEOS — only ONE video decodes/plays at a time (the active
       world's). The other is kept buffered (via preload so the swap is
       instant) but paused, halving constant video-decode cost — which
       matters a lot on battery. world.js resumes the incoming video at
       the start of a switch and pauses the outgoing one at the end.
       ----------------------------------------------------- */
    NS.preload.warmVideos([refs.archVideo, refs.conceptVideo]);
    refs.archVideo.play().catch(() => {});
    // concept starts paused (inactive) but fully buffered:
    try { refs.conceptVideo.pause(); } catch (e) {}

})(window.OV3, gsap);

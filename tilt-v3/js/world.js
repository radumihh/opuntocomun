/* =========================================================
   WORLD — Architecture <-> Concept switch.
   LEAN "crossfade + bloom" choreography. Only opacity + a couple
   of scale/translate tweens on a handful of top-level layers are
   animated — the 12+12 per-strip staggers and per-floor rotationX
   from the old "Concentric Unfold" were the #1 cause of the
   EXTREME choppiness on battery/throttled GPUs (each strip + media
   counter-move + 3D floor re-rasterised every single frame of the
   switch). Now the strips ride anonymously inside their world
   container, which composites ONCE, so the transition is a smooth
   GPU crossfade even under heavy throttling.
   ========================================================= */

(function (NS, gsap) {

    function changeWorld(next) {
        if (NS.transitioning || next === NS.currentWorld) return;
        NS.transitioning = true;

        // Set the world to the TARGET immediately (not only at the end of
        // the crossfade) so any scroll-driven logic (the pinned reveal in
        // pages.js) uses the correct world's parameters the instant the
        // transition starts — otherwise a split-second of the OLD world's
        // reveal can flash while scrolling the new world.
        // Also flip the ambient (body) theme AND the active brand page to
        // the incoming world right away, so no wrong-colour (e.g. light
        // architecture page) peeks through when the user scrolls during or
        // right after the switch.
        NS.currentWorld = next;
        if (NS.pages) {
            if (NS.pages.applyTheme) NS.pages.applyTheme(next);
            if (NS.pages.setActive) NS.pages.setActive(next);
        }

        const el = NS.refs;
        const forward = next === "concept";

        const oldSide = forward ? el.architectureSide : el.conceptSide;
        const newSide = forward ? el.conceptSide : el.architectureSide;
        const oldVideo = forward ? el.archVideo : el.conceptVideo;
        const newVideo = forward ? el.conceptVideo : el.archVideo;

        /* ---- Only ONE video decodes at a time (huge on battery). ---- */
        if (newVideo && newVideo.play) newVideo.play().catch(() => {});

        // Battery/low-power: run the switch even faster (fewer frames).
        const k = NS.perf.quality === "max" ? 1
                : NS.perf.quality === "balanced" ? 0.8 : 0.68;

        // Anchor all parallax at neutral once before the swap.
        NS.tilt.reset();

        /* ---- WORLDS (the strips ride inside — no per-strip tweens) ---- */
        const incoming = forward ? el.conceptWorld : el.architectureWorld;
        const outgoing = forward ? el.architectureWorld : el.conceptWorld;
        const newFloor = forward ? el.conceptFloor : el.archFloor;
        const oldFloor = forward ? el.archFloor : el.conceptFloor;
        const mob = NS.isMobile();

        gsap.set(incoming, { opacity: 0, scale: .92, zIndex: 3 });
        gsap.set(outgoing, { zIndex: 2 });
        gsap.set(newFloor, { opacity: 0 });

        const tl = gsap.timeline({ defaults: { ease: "expo.inOut" } });

        /* 1. INCOMING world blooms in (one composite layer). */
        tl.to(incoming, { opacity: 1, scale: 1, duration: 1.1 * k }, 0);

        /* 2. OUTGOING world fades out under it. */
        tl.to(outgoing, { opacity: 0, duration: .8 * k }, 0);

        /* 3. Floors — simple opacity crossfades (no 3D rotationX). */
        tl.to(oldFloor, { opacity: 0, duration: .6 * k }, 0);
        tl.to(newFloor, { opacity: 1, duration: .9 * k }, .05);

        /* ---- SIDES (text) — opacity + gentle slide, 2 layers ---- */
        gsap.set(newSide, {
            opacity: 1,
            x: mob ? 0 : (forward ? 120 : -120),
            y: 0,
            scale: .94
        });
        tl.to(oldSide, {
            x: mob ? 0 : (forward ? -120 : 120),
            opacity: 0,
            scale: .94,
            duration: .45 * k
        }, 0);
        tl.to(newSide, {
            x: 0, opacity: 1, scale: 1,
            duration: .8 * k, ease: "expo.out"
        }, .12);

        /* ---- TEXT COLOR — snapped via theme class in pages.js
             (called above in setActive) — zero per-frame text repaint. */

        /* ---- BG SHADE (light<->dark) ---- */
        tl.to(el.bgShade, { opacity: forward ? 1 : 0, duration: .9 * k }, 0);

        /* ---- LOGO — subtle scale pulse only (no rotation, cheaper) ---- */
        tl.to(el.oObject, { scale: 1.06, duration: .4 * k, ease: "power3.out" }, 0);
        tl.to(el.oObject, { scale: 1, duration: .7 * k, ease: "power3.out" }, .4);

        /* ---- VIDEO SWAP (settles at idle base scale 1.08) ---- */
        tl.to(oldVideo, {
            opacity: 0,
            scale: forward ? 1.12 : .9,
            x: forward ? -30 : 30,
            duration: .45 * k
        }, 0);
        tl.fromTo(newVideo,
            { opacity: 0, scale: forward ? 1.12 : .9, x: forward ? 30 : -30 },
            { opacity: 1, scale: 1.08, x: 0, duration: .85 * k, ease: "expo.out" },
            .1
        );

        /* ---- PROGRESS (transform-only) ---- */
        tl.to(el.progressFill, { scaleX: forward ? 1 : 0, duration: .8 * k }, 0);

        /* ---- COMPLETE ---- */
        tl.call(() => {
            // Pause the outgoing (now hidden) video so only ONE video
            // decodes at any time — big battery win in production.
            if (oldVideo && oldVideo.pause) {
                try { oldVideo.pause(); } catch (e) {}
            }
            NS.transitioning = false;
        });

        /* ---- FAILSAFE ----
           On some mobile browsers (notably iOS) the GSAP timeline can stop
           advancing mid-tween for various reasons. If that happens, the
           crossfade would freeze AND `NS.transitioning` would stay `true`
           forever — which also kills the gyro parallax. This native timer
           (independent of GSAP's ticker) force-completes the crossfade and
           releases the gate so the hero always switches and input resumes.
           The real tween normally finishes well before this fires. */
        clearTimeout(changeWorld._fail);
        changeWorld._fail = setTimeout(function () {
            if (NS.transitioning) {
                gsap.set(incoming, { opacity: 1, scale: 1 });
                gsap.set(outgoing, { opacity: 0 });
                gsap.set(newFloor, { opacity: 1 });
                gsap.set(oldFloor, { opacity: 0 });
                gsap.set(el.bgShade, { opacity: forward ? 1 : 0 });
                gsap.set(newSide, { opacity: 1, x: 0, scale: 1 });
                gsap.set(oldSide, { opacity: 0 });
                if (oldVideo && oldVideo.pause) { try { oldVideo.pause(); } catch (e) {} }
                NS.transitioning = false;
            }
        }, 1700);
    }

    NS.world = { changeWorld: changeWorld };

})(window.OV3, gsap);

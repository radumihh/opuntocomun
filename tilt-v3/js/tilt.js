/* =========================================================
   TILT — cursor-driven parallax (O., shadow, strips, floor,
   inner video). Runs once inside the shared GSAP ticker.

   Perf (vs v2/v3):
   - gsap.quickSetter per property: zero allocation & zero
     property parsing per frame.
   - Per-strip multipliers precomputed at build time.
   - Idle detection: the loop stops when the cursor rests at
     center (big battery win on mobile / idle desktop).
   - prefers-reduced-motion respected.
   ========================================================= */

(function (NS, gsap) {

    const lerp = gsap.utils.interpolate;

    let el = {};
    let mouseX = 0, mouseY = 0;
    let targetMouseX = 0, targetMouseY = 0;
    let idle = true;
    let reducedMotion = false;

    // quickSetters (built once in configure)
    let oSet, shadowSet, floorSet, videoSet;

    function q(target, prop, unit) {
        return gsap.quickSetter(target, prop, unit);
    }

    function configure(refs) {
        el = refs;
        reducedMotion = !!(window.matchMedia &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches);

        // Centering lives in GSAP (xPercent/yPercent) so it composes
        // with the parallax x/y instead of being clobbered when GSAP
        // rebuilds the transform matrix (the old CSS translate(-50%,-50%)
        // was lost the moment GSAP first animated these elements).
        gsap.set(el.oObject, { xPercent: -50, yPercent: -50 });
        gsap.set(el.oShadow, { xPercent: -50, yPercent: -50 });

        oSet = {
            x: q(el.oObject, "x", "px"),
            y: q(el.oObject, "y", "px"),
            z: q(el.oObject, "z", "px"),
            rx: q(el.oObject, "rotationX", "deg"),
            ry: q(el.oObject, "rotationY", "deg")
        };

        shadowSet = {
            x: q(el.oShadow, "x", "px"),
            y: q(el.oShadow, "y", "px"),
            scale: q(el.oShadow, "scale"),
            opacity: q(el.oShadow, "opacity")
        };

        floorSet = {
            arch: { x: q(el.archFloor, "x", "px"), y: q(el.archFloor, "y", "px") },
            concept: { x: q(el.conceptFloor, "x", "px"), y: q(el.conceptFloor, "y", "px") }
        };

        videoSet = {
            arch: {
                x: q(el.archVideo, "x", "px"),
                y: q(el.archVideo, "y", "px"),
                rx: q(el.archVideo, "rotationX", "deg"),
                ry: q(el.archVideo, "rotationY", "deg"),
                scale: q(el.archVideo, "scale")
            },
            concept: {
                x: q(el.conceptVideo, "x", "px"),
                y: q(el.conceptVideo, "y", "px"),
                rx: q(el.conceptVideo, "rotationX", "deg"),
                ry: q(el.conceptVideo, "rotationY", "deg"),
                scale: q(el.conceptVideo, "scale")
            }
        };
    }

    /* Shared entry point for BOTH input sources: the mouse/touch
       pointer (desktop) and the device-orientation sensor (mobile).
       Both write into the same -1..1 target space, so the rest of the
       parallax code is identical either way. */
    function setTarget(mx, my) {
        targetMouseX = mx;
        targetMouseY = my;
        idle = false;
    }

    function onPointerMove(e) {
        setTarget(
            (e.clientX / window.innerWidth) * 2 - 1,
            (e.clientY / window.innerHeight) * 2 - 1
        );
    }

    function applyParallax(mx, my) {
        const abs = Math.abs(mx) + Math.abs(my);

        oSet.x(mx * 30);
        oSet.y(my * 22);
        oSet.z(180 + mx * 32);
        oSet.rx(my * -52);
        oSet.ry(mx * 62);

        shadowSet.x(mx * -58);
        shadowSet.y(my * 58);
        shadowSet.scale(1 - abs * .3);
        shadowSet.opacity(.6 - abs * .32);

        const wall = NS.currentWorld === "concept" ? el.conceptStrips : el.archStrips;
        for (let i = 0; i < wall.length; i++) {
            const s = wall[i];
            const k = s._k;
            const m = s._media;
            s._sx(k.x * mx);
            s._sy(k.y * my);
            m._sx(k.mx * mx);
            m._sy(k.my * my);
        }

        const floor = NS.currentWorld === "concept" ? floorSet.concept : floorSet.arch;
        floor.x(mx * -24);
        floor.y(my * -10);

        const active = NS.currentWorld === "concept" ? videoSet.concept : videoSet.arch;
        const inactive = NS.currentWorld === "concept" ? videoSet.arch : videoSet.concept;

        active.scale(1.08);
        active.rx(my * 10);
        active.ry(mx * -14);
        active.x(mx * -10);
        active.y(my * -6);

        inactive.rx(0);
        inactive.ry(0);
        inactive.x(0);
        inactive.y(0);
    }

    /* One-time neutral reset (transition start & idle snap). */
    function resetTransforms() {
        shadowSet.x(0); shadowSet.y(0);
        shadowSet.scale(1); shadowSet.opacity(.6);

        videoSet.arch.rx(0); videoSet.arch.ry(0);
        videoSet.arch.x(0); videoSet.arch.y(0);
        videoSet.concept.rx(0); videoSet.concept.ry(0);
        videoSet.concept.x(0); videoSet.concept.y(0);

        const strips = el.archStrips.concat(el.conceptStrips);
        for (let i = 0; i < strips.length; i++) {
            strips[i]._sx(0);
            strips[i]._sy(0);
            strips[i]._media._sx(0);
            strips[i]._media._sy(0);
        }

        floorSet.arch.x(0); floorSet.arch.y(0);
        floorSet.concept.x(0); floorSet.concept.y(0);
    }

    function tick() {
        mouseX = lerp(mouseX, targetMouseX, .07);
        mouseY = lerp(mouseY, targetMouseY, .07);

        if (NS.transitioning || reducedMotion) return;
        if (idle) return;
        if (NS.inHero === false) return;

        applyParallax(mouseX, mouseY);

        if (Math.abs(targetMouseX - mouseX) < .0004 &&
            Math.abs(targetMouseY - mouseY) < .0004) {
            idle = true;
            resetTransforms();
        }
    }

    NS.tilt = {
        configure: configure,
        setTarget: setTarget,
        onPointerMove: onPointerMove,
        tick: tick,
        reset: resetTransforms
    };

})(window.OV3, gsap);

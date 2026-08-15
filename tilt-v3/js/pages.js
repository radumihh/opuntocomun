/* =========================================================
   PAGES — the two brand "bodies" below the hero.

   Toggles which page is visible AND drives the PINNED REVEAL
   choreography: as the user scrolls down, the hero stays
   pinned (CSS sticky) while the active page rises over it.
   The hero recedes differently per world:
     - Architecture : gentle recession (little scale / fade)  -> fine
     - Concept      : hard push-back (scale + rotate + skew)   -> crazy
   ========================================================= */

(function (NS, gsap) {

    const $ = (id) => document.getElementById(id);

    /* Ambient background follows the active world so scrolling down
       from concept always sits on a dark surface (and switching back
       to architecture clears any leftover dark). Foreground text is
       snapped to the matching ink via instant classes — no per-frame
       color tween, which was a transition-throttle culprit on battery. */
    function applyTheme(world) {
        var onConcept = world === "concept";
        document.body.classList.toggle("theme-concept", onConcept);
        document.body.classList.toggle("theme-architecture", !onConcept);
        document.body.classList.toggle("theme-text-light", onConcept);
        document.body.classList.toggle("theme-text-dark", !onConcept);
    }

    function setActive(world) {
        const arch = $("archPage");
        const concept = $("conceptPage");
        if (!arch || !concept) return;
        const onArch = world === "architecture";
        arch.classList.toggle("is-active", onArch);
        concept.classList.toggle("is-active", !onArch);
        applyTheme(world);
        // Snap the reveal back to rest after switching (scroll is at hero).
        if (NS.refs) applyReveal(0, true);
    }

    /* -----------------------------------------------------
       PINNED REVEAL
       p = 0 (hero fully visible)  ->  p = 1 (page covers).
       Transforms are applied to the hero root only, so they
       never fight the per-child tilt/cursor parallax.
       ----------------------------------------------------- */
    let lastWorld = null;
    let lastP = -1;

    function applyReveal(top, force) {
        const refs = NS.refs;
        if (!refs || !refs.hero) return;
        const hero = refs.hero;
        const h = hero.offsetHeight || window.innerHeight;
        const p = Math.min(1, Math.max(0, top / h));

        const world = NS.currentWorld === "concept" ? "concept" : "architecture";
        if (!force && world === lastWorld && Math.abs(p - lastP) < 0.0005) return;
        lastWorld = world;
        lastP = p;

        let scale, y, x, rot, skew, op;
        // On battery / low power, drop the skew+rotate (they force the
        // whole hero — filtered walls, floors, video — to be re-rasterised
        // every scroll frame, which throttles hard). scale/y/opacity are
        // pure GPU composite and stay buttery.
        const vivid = (NS.perf.quality === "max");
        if (world === "architecture") {
            /* fine / subtle */
            scale = 1 - 0.03 * p;
            y = -14 * p;
            x = 0;
            rot = 0;
            skew = 0;
            op = 1 - 0.12 * p;
        } else if (vivid) {
            /* crazy / aggressive (full power only) */
            scale = 1 - 0.16 * p;
            y = -46 * p;
            x = -10 * p;
            rot = 3.5 * p;
            skew = -3 * p;
            op = 1 - 0.55 * p;
        } else {
            /* concept but transform-only on battery — still a strong push */
            scale = 1 - 0.14 * p;
            y = -40 * p;
            x = 0;
            rot = 0;
            skew = 0;
            op = 1 - 0.5 * p;
        }

        gsap.set(hero, {
            scale: scale,
            x: x,
            y: y,
            rotation: rot,
            skewX: skew,
            opacity: op,
            transformOrigin: "50% 100%"
        });
    }

    function init() {
        setActive(NS.currentWorld || "architecture");
        if (!NS.refs || !NS.refs.siteScroll) return;

        const reduced = !!(window.matchMedia &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches);
        if (reduced) return; // plain slide, no recession

        const scroll = NS.refs.siteScroll;
        function onScroll() {
            applyReveal(scroll.scrollTop, false);
        }
        scroll.addEventListener("scroll", onScroll, { passive: true });
        if (window.gsap && gsap.ticker) {
            gsap.ticker.add(onScroll);
        } else {
            window.addEventListener("scroll", onScroll, { passive: true });
        }
    }

    NS.pages = {
        init: init,
        setActive: setActive,
        applyTheme: applyTheme
    };

})(window.OV3, window.gsap);

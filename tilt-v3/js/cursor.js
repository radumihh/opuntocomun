/* =========================================================
   CURSOR — custom ring + dot.
   Transform-based positioning (GPU) + rest detection so it
   stops writing entirely once it catches the pointer.
   ========================================================= */

(function (NS, gsap) {

    function init(cursorEl, dotEl) {
        if (NS.isMobile()) return null; // native cursor on touch

        const lerp = gsap.utils.interpolate;
        const hc = cursorEl.offsetWidth / 2;
        const hd = dotEl.offsetWidth / 2;

        let targetX = window.innerWidth / 2;
        let targetY = window.innerHeight / 2;
        let lastTX = targetX, lastTY = targetY;
        let ringX = targetX, ringY = targetY;
        let dotX = targetX, dotY = targetY;

        const place = (el, x, y, half) => {
            el.style.transform =
                "translate3d(" + (x - half) + "px," + (y - half) + "px,0)";
        };

        // Initial placement (no flash at 0,0)
        place(cursorEl, targetX, targetY, hc);
        place(dotEl, targetX, targetY, hd);

        window.addEventListener("pointermove", (e) => {
            targetX = e.clientX;
            targetY = e.clientY;
        }, { passive: true });

        function tick() {
            const moving = targetX !== lastTX || targetY !== lastTY;
            lastTX = targetX; lastTY = targetY;

            const settled = !moving &&
                Math.abs(ringX - targetX) < .01 && Math.abs(ringY - targetY) < .01 &&
                Math.abs(dotX - targetX) < .01 && Math.abs(dotY - targetY) < .01;
            if (settled) return;

            ringX = lerp(ringX, targetX, .16);
            ringY = lerp(ringY, targetY, .16);
            dotX = lerp(dotX, targetX, .35);
            dotY = lerp(dotY, targetY, .35);

            place(cursorEl, ringX, ringY, hc);
            place(dotEl, dotX, dotY, hd);
        }

        return tick;
    }

    NS.cursor = { init: init };

})(window.OV3, gsap);

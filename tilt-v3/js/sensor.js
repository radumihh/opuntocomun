/* =========================================================
   SENSOR — device-orientation control for mobile.

   On touch devices (where there is no mouse / drag), the hero
   parallax is driven by how the phone is tilted instead:

     - tilt the phone forward / back   -> move up / down
     - roll the phone left / right     -> move left / right

   It feeds the SAME -1..1 target space as the pointer via
   NS.tilt.setTarget(), so tilt.js needs zero changes to the
   rendering side. A dead-zone snaps near-flat values to 0 so
   tilt.js's own idle / reset logic can still kick in (battery).

   iOS 13+ needs an explicit permission, requested on the first
   touch (a user gesture), to keep it minimal and non-intrusive.
   ========================================================= */

(function (NS) {

    var enabled = false;    // true once a real sensor reading arrives
    var listening = false;  // true once we've subscribed to the sensor

    function isTouchDevice() {
        return NS.isMobile() &&
            ("ontouchstart" in window || navigator.maxTouchPoints > 0);
    }

    /* Normalise a raw angle into -1..1 over [min, max]; centre -> 0. */
    function norm(v, min, max) {
        var t = (v - min) / (max - min) * 2 - 1;
        if (t < -1) return -1;
        if (t > 1) return 1;
        return t;
    }

    /* Dead-zone: tiny tilts snap to exactly 0, so the device visibly
       resting flat lets tilt.js idle + reset (bigger battery win). */
    function deadzone(v) {
        var dz = 0.07;
        var a = v < 0 ? -v : v;
        if (a < dz) return 0;
        return (v - (v < 0 ? -dz : dz)) / (1 - dz);
    }

    function handleOrientation(e) {
        // beta: front/back tilt (-180..180)  -> vertical
        // gamma: left/right roll (-90..90)   -> horizontal
        if (e.beta == null || e.gamma == null) return;
        var my = deadzone(norm(e.beta, -38, 38));
        var mx = deadzone(norm(e.gamma, -42, 42));
        NS.tilt.setTarget(mx, my);
        enabled = true;
    }

    function start() {
        if (listening) return;
        listening = true;
        window.addEventListener("deviceorientation", handleOrientation, true);
    }

    function requestPermission() {
        var DOE = window.DeviceOrientationEvent;
        if (DOE && typeof DOE.requestPermission === "function") {
            // iOS 13+: must be called from a user gesture.
            DOE.requestPermission().then(function (state) {
                if (state === "granted") start();
            }).catch(function () {});
        } else {
            start(); // Android / desktop-ish: no permission gate
        }
    }

    function init() {
        if (!isTouchDevice()) return;
        var DOE = window.DeviceOrientationEvent;
        if (DOE && typeof DOE.requestPermission === "function") {
            // Request on the first interaction (iOS requires it).
            var once = function () {
                removeEventListener("pointerdown", once, true);
                removeEventListener("touchend", once, true);
                requestPermission();
            };
            window.addEventListener("pointerdown", once, true);
            window.addEventListener("touchend", once, true);
        } else {
            requestPermission();
        }
    }

    NS.sensor = {
        init: init,
        get active() { return enabled; }
    };

})(window.OV3);

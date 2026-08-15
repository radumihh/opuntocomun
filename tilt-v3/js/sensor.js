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

    /* The gyro is used as a *direction* sensor only. It does NOT hold the
       logo at a fixed tilt — instead each reading nudges the parallax in
       the direction the phone is moving, and the effect always drifts back
       to the neutral / "standard" centre. Tilt right  -> logo moves right,
       then it smoothly returns to rest. Nothing ever stays frozen.
       ---------------------------------------------------------------- */
    var SENS = 1.6;      // how much a given tilt contributes (sensitivity)
    var VEL_GAIN = 0.5;  // how strongly the direction of motion displaces it
    var RETURN = 2.5;    // 1/s — how fast it returns to centre (bigger = faster)

    /* Safety net: if the phone has been still for a while (or the sensor
       goes quiet), ease everything back to neutral over a gentle tween. */
    var RESET_EVERY = 3000; // ms between reset opportunities
    var RESET_DUR = 0.9;    // s the reset tween lasts
    var RESET_STILL = 1200; // ms of stillness required before a reset
    var resetting = false;
    var lastMove = 0;

    var lastT = 0;          // last orientation timestamp (for dt)
    var lastMx = 0, lastMy = 0; // previous absolute tilt (for velocity)
    var impX = 0, impY = 0; // current applied displacement (decays to 0)

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

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

    /* Dead-zone: tiny tilts snap to exactly 0 (ignored), so resting flat
       feels neutral and sensor noise doesn't cause drift. */
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

        // Current absolute tilt, signs set so tilt-right -> mx positive
        // (which tilt.js renders as "moves right"). SENS = sensitivity.
        var mx = -deadzone(norm(e.gamma, -42, 42)) * SENS;
        var my = -deadzone(norm(e.beta, -38, 38)) * SENS;

        // Time since the last reading (frame-rate independent).
        var now = performance.now();
        var dt = lastT ? Math.min(0.1, Math.max(0.008, (now - lastT) / 1000)) : 0.016;
        lastT = now;

        // Direction of motion = change vs the previous reading.
        var dvx = mx - lastMx;
        var dvy = my - lastMy;
        lastMx = mx;
        lastMy = my;

        // Exponential return to centre: the applied displacement always
        // drifts back to 0 at RETURN per second (smooth, gradual).
        var drop = Math.max(0, 1 - RETURN * dt);

        // Nudge the displacement by the direction of motion (VEL_GAIN),
        // then let it decay back to neutral.
        impX = clamp(impX * drop + dvx * VEL_GAIN, -1, 1);
        impY = clamp(impY * drop + dvy * VEL_GAIN, -1, 1);

        // Only feed tilt.js when there is something real to render, so the
        // hero's own idle logic can settle/progress once back at centre.
        if (Math.abs(impX) > 0.015 || Math.abs(impY) > 0.015) {
            NS.tilt.setTarget(impX, impY);
            lastMove = now;   // user is "moving" while there's displacement
        } else {
            impX = 0; impY = 0;
        }
        enabled = true;
    }

    /* Safety net: if the phone has been still (no displacement) for a while,
       or the sensor went quiet mid-offset, ease back to neutral smoothly. */
    function smoothReset() {
        if (resetting || !enabled || NS.transitioning || !window.gsap) return;
        if (Date.now() - lastMove < RESET_STILL) return;
        resetting = true;
        lastT = 0; lastMx = 0; lastMy = 0; impX = 0; impY = 0;
        var state = { x: 0, y: 0 };
        window.gsap.to(state, {
            x: 0, y: 0,
            duration: RESET_DUR,
            ease: "power2.inOut",
            onUpdate: function () { NS.tilt.setTarget(state.x, state.y); },
            onComplete: function () { resetting = false; }
        });
    }

    function start() {
        if (listening) return;
        listening = true;
        window.addEventListener("deviceorientation", handleOrientation, true);
        // Safety-net recenter (see smoothReset above).
        setInterval(smoothReset, RESET_EVERY);
    }

    /* Request iOS permission from within a user gesture. Safe to call
       many times (harmless no-op once granted/denied / non-iOS / desktop). */
    function request() {
        if (listening || enabled) return;
        var DOE = window.DeviceOrientationEvent;
        if (DOE && typeof DOE.requestPermission === "function") {
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
            // iOS 13+ requires a user gesture before it reveals orientation
            // data. Request on the first interaction and keep re-arming the
            // guard until the sensor is actually live (once granted, iOS just
            // resolves immediately — no repeated system prompt). Do NOT attach
            // this to the tappable logo: a prompt spawned inside that gesture
            // swallows the synthetic `click`, breaking the tap→transition.
            var arm = function () {
                if (enabled || listening) return; // already live
                request();
            };
            window.addEventListener("touchstart", arm, { passive: true, capture: true });
        } else {
            start(); // Android / desktop-ish: no permission gate
        }
    }

    NS.sensor = {
        init: init,
        request: request,
        get active() { return enabled; }
    };

})(window.OV3);

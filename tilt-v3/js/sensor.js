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
    var SENS = 1.5;      // how much a given tilt contributes (sensitivity)
    var VEL_GAIN = 0.55; // how strongly the direction of motion displaces it
    var RETURN = 2.5;    // 1/s — how fast it returns to centre (bigger = faster)

    /* A **baseline calibration** is captured as soon as the sensor starts:
       the phone's orientation the moment data arrives becomes "neutral".
       iOS reports beta/gamma in a screen-anchored reference frame (beta is
       ~90 when held upright, not 0), so without this the mapping would be
       garbage. Motion is measured relative to that resting position, which
       is what makes the direction/tilt feel right on any device. */
    var baseBeta = null, baseGamma = null;
    var CALIB_READINGS = 4;  // how many readings to average for the baseline
    var calibCount = 0;
    var calibBeta = 0, calibGamma = 0;

    /* Safety net: if the phone has been still for a while (or the sensor
       goes quiet), ease everything back to neutral over a gentle tween. */
    var RESET_EVERY = 3000; // ms between reset opportunities
    var RESET_DUR = 0.9;    // s the reset tween lasts
    var RESET_STILL = 1200; // ms of stillness required before a reset
    var resetting = false;
    var lastMove = 0;

    var lastT = 0;              // last orientation timestamp (for dt)
    var lastRx = 0, lastRy = 0; // previous *relative* tilt (for velocity)
    var impX = 0, impY = 0;     // current applied displacement (decays to 0)

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

    function isTouchDevice() {
        return NS.isMobile() &&
            ("ontouchstart" in window || navigator.maxTouchPoints > 0);
    }

    /* Dead-zone: tiny tilts snap to exactly 0 (ignored), so resting flat
       feels neutral and sensor noise doesn't cause drift. */
    function deadzone(v) {
        var dz = 0.02;
        var a = v < 0 ? -v : v;
        if (a < dz) return 0;
        return (v - (v < 0 ? -dz : dz)) / (1 - dz);
    }

    /* Degrees -> -1..1 using a soft, non-clamped curve so we never pin the
       value at an edge (iOS's reference frame puts beta ~90 upright, which
       a hard clamp would destroy). /35deg -> ~1. */
    function toUnit(v) {
        return Math.atan(v / 35) / (Math.PI / 2);
    }

    /* Calibrate the resting ("neutral") orientation from the first few
       readings, so motion is measured relative to how the user holds the
       phone rather than to a hard-coded flat value. */
    function calibrate(beta, gamma) {
        calibBeta += beta;
        calibGamma += gamma;
        calibCount++;
        if (calibCount < CALIB_READINGS) return false;
        baseBeta = calibBeta / calibCount;
        baseGamma = calibGamma / calibCount;
        calibCount = 0;
        calibBeta = 0;
        calibGamma = 0;
        return true;
    }

    function handleOrientation(e) {
        // beta: front/back tilt (-180..180)  -> vertical
        // gamma: left/right roll (-90..90)   -> horizontal
        if (e.beta == null || e.gamma == null) return;
        enabled = true;

        // Establish the baseline first (a handful of rapid readings).
        if (baseBeta == null) {
            if (!calibrate(e.beta, e.gamma)) {
                // Still gathering the baseline — reset the velocity history
                // so the first *real* relative reading doesn't jump.
                lastRx = 0; lastRy = 0;
                return;
            }
        }

        // Motion relative to where the phone was resting = tilt direction.
        // Right roll (gamma +) -> rx + -> logo moves right (see below).
        var rx = toUnit(e.gamma - baseGamma);
        var ry = toUnit(e.beta - baseBeta);

        // Small deadzone on the relative tilt keeps settled hands still.
        rx = deadzone(rx) * SENS;
        ry = deadzone(ry) * SENS;

        // Time since the last reading (frame-rate independent).
        var now = performance.now();
        var dt = lastT ? Math.min(0.1, Math.max(0.008, (now - lastT) / 1000)) : 0.016;
        lastT = now;

        // Direction of motion = change vs the previous relative tilt.
        var dvx = rx - lastRx;
        var dvy = ry - lastRy;
        lastRx = rx;
        lastRy = ry;

        // Exponential return to centre: applied displacement always drifts
        // back to 0 at RETURN per second (smooth, gradual).
        var drop = Math.max(0, 1 - RETURN * dt);

        // Nudge the displacement by the direction of motion, then decay.
        impX = clamp(impX * drop + dvx * VEL_GAIN, -1, 1);
        impY = clamp(impY * drop + dvy * VEL_GAIN, -1, 1);

        // Only feed tilt.js when there is something real to render.
        if (Math.abs(impX) > 0.012 || Math.abs(impY) > 0.012) {
            NS.tilt.setTarget(impX, impY);
            lastMove = now;
        } else {
            impX = 0; impY = 0;
        }
    }

    /* Safety net: if the phone has been still for a while, or the sensor
       went quiet mid-offset, ease back to neutral smoothly and re-calibrate
       the baseline so "neutral" stays where the phone is resting. */
    function smoothReset() {
        if (resetting || !enabled || NS.transitioning || !window.gsap) return;
        if (Date.now() - lastMove < RESET_STILL) return;
        resetting = true;
        baseBeta = null; baseGamma = null;
        calibCount = 0; calibBeta = 0; calibGamma = 0;
        lastT = 0; lastRx = 0; lastRy = 0; impX = 0; impY = 0;
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
        var DOE = window.DeviceOrientationEvent;
        var iOS = DOE && typeof DOE.requestPermission === "function";
        // iOS fires "deviceorientation" freely; Android's give the raw
        // absolute frame, so plain "deviceorientation" is enough there.
        if (iOS) window.addEventListener("deviceorientationabsolute", handleOrientation, true);
        window.addEventListener("deviceorientation", handleOrientation, true);
        // Safety-net recenter (see smoothReset above).
        setInterval(smoothReset, RESET_EVERY);
        if (window.__sensorDebug) console.log("[sensor] listening", { ios: iOS });
    }

    /* Request iOS permission from within a user gesture. Safe to call many
       times (harmless no-op once granted/denied / non-iOS / desktop). */
    function request() {
        if (listening || enabled) return;
        var DOE = window.DeviceOrientationEvent;
        if (DOE && typeof DOE.requestPermission === "function") {
            DOE.requestPermission().then(function (state) {
                if (window.__sensorDebug) console.log("[sensor] iOS permission:", state);
                if (state === "granted") start();
            }).catch(function (err) {
                if (window.__sensorDebug) console.log("[sensor] iOS permission error", err);
            });
        } else {
            start(); // Android / desktop-ish: no permission gate
        }
    }

    function init() {
        if (!isTouchDevice()) return;
        var DOE = window.DeviceOrientationEvent;
        if (DOE && typeof DOE.requestPermission === "function") {
            // iOS: permission MUST be requested inside a user gesture. We arm
            // on several event types so the very first real interaction (tap,
            // press, drag, release) triggers it, and keep re-arming until the
            // sensor is live. Once granted, iOS just resolves immediately, so
            // there is no repeated system prompt.
            var arm = function () {
                if (enabled || listening) return;
                request();
            };
            ["touchstart", "touchend", "pointerdown", "click"].forEach(function (type) {
                window.addEventListener(type, arm, { passive: true, capture: true });
            });
        } else {
            start();
        }
    }

    NS.sensor = {
        init: init,
        request: request,
        get active() { return enabled; }
    };

})(window.OV3);

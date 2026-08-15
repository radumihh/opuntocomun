/* =========================================================
   PRELOAD — keeps media "on the pipeline" so transitions and
   first paints never hitch.

   Strategy (zero change to the visible experience/animations):
   1. Videos  — both are force-buffered and kept warm so the
      swap during a world change is instant (no loading pause).
   2. Images  — the exact image set currently used by both
      walls is preloaded AND pre-decoded right after build, so
      the very first paint (incl. the hidden world that shows
      during a transition) is jank-free.
   3. Full manifest — the remaining wall images are fetched
      into cache in the background with bounded concurrency,
      scheduled via requestIdleCallback so it never competes
      with the main thread or the animation loop.
   ========================================================= */

(function (NS) {

    /* -----------------------------------------------------
       Videos — buffer both fully, keep them playing.
       ----------------------------------------------------- */
    function warmVideos(videos) {
        videos.forEach(function (v) {
            if (!v) return;
            v.preload = "auto";

            var warm = function () {
                // Keep the play cursor advancing so the browser
                // continues buffering ahead even when hidden.
                try {
                    if (v.paused && v.readyState >= 1) {
                        v.play().catch(function () {});
                    }
                } catch (e) { /* ignore */ }
            };

            v.addEventListener("loadeddata", warm);
            v.addEventListener("canplay", warm);
            v.addEventListener("timeupdate", warm);

            // Force the engine to start fetching now.
            try { v.load(); } catch (e) { /* ignore */ }
        });
    }

    /* -----------------------------------------------------
       Images — bounded, idle-scheduled cache + decode warm.
       ----------------------------------------------------- */
    var CONCURRENCY = 4;
    var queue = [];
    var inFlight = 0;
    var scheduled = false;
    var warmed = {};   // cache of urls we already began

    function pump() {
        while (inFlight < CONCURRENCY && queue.length) {
            var url = queue.shift();
            if (warmed[url]) continue;
            warmed[url] = true;
            inFlight++;
            var img = new Image();
            img.onload = img.onerror = function () {
                inFlight--;
                // Best-effort pre-decode so first paint is instant.
                if (img.decode) {
                    img.decode().catch(function () {});
                }
                pump();
            };
            img.src = url;
        }
        if (!queue.length && !inFlight) scheduled = false;
    }

    function schedule() {
        if (scheduled) return;
        scheduled = true;
        var run = function () {
            scheduled = false;
            pump();
        };
        if (typeof requestIdleCallback === "function") {
            requestIdleCallback(run, { timeout: 2000 });
        } else {
            setTimeout(run, 0);
        }
    }

    /**
     * Warm a list of urls (deduplicated) into the image cache,
     * decoding them so the browser never has to on first paint.
     */
    function images(urls) {
        for (var i = 0; i < urls.length; i++) {
            if (!urls[i]) continue;
            if (warmed[urls[i]]) continue;
            queue.push(urls[i]);
        }
        schedule();
    }

    /**
     * Eagerly preload+decode a small, known-critical set now
     * (the currently-built walls) — these MUST be jank-free.
     */
    function imagesNow(urls) {
        var i, img;
        for (i = 0; i < urls.length; i++) {
            if (!urls[i] || warmed[urls[i]]) continue;
            warmed[urls[i]] = true;
            img = new Image();
            img.src = urls[i];
            if (img.decode) {
                img.decode().catch(function () {});
            }
        }
        // Also enqueue the rest via the idle pump if not shown now.
        images(urls);
    }

    /* -----------------------------------------------------
       loadAll — fetch EVERY url (deduped) into the browser
       cache at full resolution, report progress, callback.
       Used by the loading screen so the first paint (and all
       transitions) are jank-free: nothing swaps mid-frame.
       ----------------------------------------------------- */
    function loadAll(urls, onProgress, onDone) {
        var seen = {};
        var list = [];
        var i, url;
        for (i = 0; i < urls.length; i++) {
            url = urls[i];
            if (!url) continue;
            if (seen[url]) continue;
            seen[url] = true;
            list.push(url);
        }

        var total = list.length;
        var loaded = 0;
        var started = 0;

        function tick() {
            var pct = total === 0
                ? 100
                : Math.min(100, Math.round((loaded / total) * 100));
            if (onProgress) onProgress(pct);
            if (loaded >= total) {
                if (onDone) onDone();
                return true;
            }
            return false;
        }

        function pump() {
            while (started - loaded < 6 && loaded < total) {
                (function (u) {
                    started++;
                    var img = new Image();
                    img.onload = img.onerror = function () {
                        loaded++;
                        if (img.decode) {
                            img.decode().catch(function () {}).then(tick);
                        } else {
                            tick();
                        }
                        pump();
                    };
                    img.src = u;
                })(list[loaded]);
            }
            tick();
        }

        if (total === 0) { tick(); return; }
        pump();
    }

    NS.preload = {
        warmVideos: warmVideos,
        images: images,
        imagesNow: imagesNow,
        loadAll: loadAll
    };

})(window.OV3);

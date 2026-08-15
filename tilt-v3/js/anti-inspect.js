/* =========================================================
   ANTI-INSPECT — blocks common devtools / inspection paths.
   ========================================================= */

(function () {
    // Right-click
    document.addEventListener("contextmenu", (e) => e.preventDefault());

    // Drag of images
    document.addEventListener("dragstart", (e) => {
        if (e.target && e.target.tagName === "IMG") e.preventDefault();
    });

    // Common devtools shortcuts
    document.addEventListener("keydown", (e) => {
        const k = e.key;
        const ctrl = e.ctrlKey || e.metaKey;

        const blocked =
            (e.key === "F12") ||
            (ctrl && e.shiftKey && (k === "I" || k === "J" || k === "C" || k === "K")) ||
            (ctrl && (k === "u" || k === "U" || k === "s" || k === "S" || k === "p" || k === "P"));

        if (blocked) e.preventDefault();
    });
})();

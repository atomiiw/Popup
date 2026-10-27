// console-bridge.js — Runs in MAIN world so JR.diagnose() works from the browser console.
// Communicates with the content script (ISOLATED world) via a CustomEvent on document.
(function () {
  window.JR = window.JR || {};
  /**
   * Self-check: which ChatGPT hooks Popup can find, plus perf counters.
   * The report is logged by the content script and kept in #jr-diagnostics[data-json].
   * Usage: JR.diagnose()  |  JR.diagnose({break: "composer"})  |  JR.diagnose({unbreak: true})
   */
  window.JR.diagnose = function (opts) {
    document.dispatchEvent(new CustomEvent("jr-diagnose", { detail: opts ? JSON.stringify(opts) : null }));
    var el = document.getElementById("jr-diagnostics");
    return el ? JSON.parse(el.getAttribute("data-json")) : null;
  };
})();

// console-bridge.js — Runs in MAIN world so JR.go() works from the browser console.
// Communicates with the content script (ISOLATED world) via CustomEvents on document.
(function () {
  window.JR = window.JR || {};
  window.JR.go = function (itemId) {
    if (arguments.length === 0) {
      document.dispatchEvent(new CustomEvent("jr-go", { detail: "__LIST__" }));
    } else {
      document.dispatchEvent(new CustomEvent("jr-go", { detail: itemId || null }));
    }
  };
  window.JR.open = function (quoteId, itemIndex) {
    document.dispatchEvent(new CustomEvent("jr-open", { detail: { quoteId: quoteId, itemIndex: itemIndex } }));
  };
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
  window.JR.locate = function (hlId) {
    document.dispatchEvent(new CustomEvent("jr-locate", { detail: hlId || null }));
  };
  /**
   * Compare two DOM nodes. Returns -1 if a is before b, 1 if after, 0 if same.
   * Usage: JR.compare(nodeA, nodeB)
   */
  window.JR.compare = function (a, b) {
    if (a === b) return 0;
    var pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    if (pos & Node.DOCUMENT_POSITION_CONTAINS) return 1;
    if (pos & Node.DOCUMENT_POSITION_CONTAINED_BY) return -1;
    return 0;
  };
  /**
   * Get the DOM element of the current active search match, or all matches.
   * Usage:
   *   JR.found()        — returns the active match <mark> element
   *   JR.found("all")   — returns array of all match <mark> elements
   */
  window.JR.found = function (mode) {
    if (mode === "all") {
      return Array.from(document.querySelectorAll(".jr-search-mark"));
    }
    return document.querySelector(".jr-search-mark-active") || null;
  };
})();

// R36h observation (testing only; MAIN world via chrome_js.py @file, read-only): ChatGPT reveals streamed
// words with the CSS Custom Highlight API — ranges in highlights named dil-word-0, dil-word-1, … styled by
// `[data-d-stream-run]::highlight(dil-word-N)` (transparent → full ink). Per frame for 40 s after a send
// (Return in a popup or in ChatGPT's composer): every dil-word-* highlight's range count, and for each range
// whether it lies in the newest turn, in a Popup-hidden turn, or in a popup; plus the words it covers.
// Read: JSON.stringify(window.__jrHl)
(function () {
  if (window.__jrHlOn) return "already";
  window.__jrHlOn = true;
  var H = window.__jrHl = { frames: [] }, on = false, t0 = 0;
  function where(range) {
    var n = range.startContainer, el = n.nodeType === 1 ? n : n.parentElement;
    if (!el) return "?";
    if (el.closest(".jr-popup")) return "popup";
    var turn = el.closest("[data-turn-key]");
    if (!turn) return "elsewhere";
    if (getComputedStyle(turn).display === "none") return "hiddenTurn";
    var turns = document.querySelectorAll("[data-turn-key]");
    return turn === turns[turns.length - 1] ? "newestTurn" : "otherTurn";
  }
  function start(how) {
    if (on) return; on = true; t0 = performance.now(); H.frames = []; H.how = how;
    (function loop() {
      var t = Math.round(performance.now() - t0), f = { t: t, hl: {} }, any = false;
      if (window.CSS && CSS.highlights) {
        CSS.highlights.forEach(function (hl, name) {
          if (!/^dil-/.test(name)) return;
          var places = {}, words = [];
          hl.forEach(function (r) { var w = where(r); places[w] = (places[w] || 0) + 1; if (words.length < 3) words.push(r.toString().slice(0, 12)); });
          if (hl.size) { f.hl[name] = { n: hl.size, places: places, words: words }; any = true; }
        });
      }
      if (any || H.frames.length === 0 || t - H.frames[H.frames.length - 1].t > 1000) H.frames.push(f);
      if (t < 40000) requestAnimationFrame(loop); else on = false;
    })();
  }
  window.__jrHlStart = start;
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" || e.shiftKey || !e.target.closest) return;
    if (e.target.closest(".jr-popup")) start("popup");
    else if (e.target.closest(".ProseMirror")) start("composer");
  }, true);
  document.addEventListener("click", function (e) { if (e.target.closest && e.target.closest(".jr-popup-edit-send")) start("popup-arrow"); }, true);
  return "highlight log on";
})();

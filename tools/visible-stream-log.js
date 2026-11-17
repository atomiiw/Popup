// Control (testing only; MAIN world, read-only): how does ChatGPT stream a VISIBLE answer in the main chat?
// Arms on Return in ChatGPT's own composer; for 40 s per frame: newest turn's text length, ChatGPT fade
// elements and running animations in it. Compare with the hidden Popup turn (stream-path-log.js).
// Read: JSON.stringify(window.__jrVis)
(function () {
  if (window.__jrVisOn) return "already";
  window.__jrVisOn = true;
  var V = window.__jrVis = { frames: [] }, on = false, t0 = 0;
  var FADE = "[class*='FadeIn-'], [class*='WordArrival-'], [data-streaming-word]";
  function start() {
    if (on) return; on = true; t0 = performance.now(); V.frames = [];
    (function loop() {
      var t = Math.round(performance.now() - t0);
      var turns = document.querySelectorAll("[data-turn-key]"), last = turns[turns.length - 1];
      var els = last ? last.querySelectorAll(FADE) : [], n = 0;
      [].forEach.call(els, function (e) { if (e.getAnimations && e.getAnimations().length) n++; });
      var root = last && last.querySelector("[data-markdown-text-style='assistant-message']");
      V.frames.push([t, last ? (last.textContent || "").length : -1, els.length, n,
        root ? (String(root.className).indexOf("AdaptiveStreaming") !== -1 ? "adaptive" : "") + (root.hasAttribute("data-markdown-animated") ? "+animated" : "") : null]);
      if (t < 40000) requestAnimationFrame(function () { setTimeout(loop, 0); }); else on = false;
    })();
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && e.target.closest && e.target.closest(".ProseMirror")) start();
  }, true);
  return "visible stream log on";
})();

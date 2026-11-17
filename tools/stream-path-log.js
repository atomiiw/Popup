// Stream path log v2 (testing only; MAIN world via chrome_js.py @file, read-only). After a popup send, for
// 60 s: (1) one row per change: hidden Q&A turn mounted, popup = mirror (ChatGPT data-* marks) or Popup's own
// drawing, markdown root context (MarkdownRoot / AdaptiveStreaming / data-markdown-animated); (2) per frame
// while streaming: text length in the hidden turn and in the popup, ChatGPT fade elements and running
// animations in both — to see whether words arrive one by one with a fade or in batches.
// Read: JSON.stringify(window.__jrPath2)
(function () {
  if (window.__jrPath3On) return "already";
  window.__jrPath3On = true;
  var P = window.__jrPath2 = { rows: [], frames: [] }, t0 = 0, on = false, last = "";
  var FADE = "[class*='FadeIn-'], [class*='WordArrival-'], [data-streaming-word]";
  function anim(root) {
    var els = root ? root.querySelectorAll(FADE) : [], n = 0;
    [].forEach.call(els, function (e) { if (e.getAnimations && e.getAnimations().length) n++; });
    return [els.length, n];
  }
  function textNoCode(el) {
    var c = el.cloneNode(true); [].forEach.call(c.querySelectorAll("pre, .cm-editor, code"), function (x) { x.remove(); });
    return c.textContent || "";
  }
  function sample() {
    var pops = document.querySelectorAll(".jr-popup"), pop = pops[pops.length - 1];
    var r = pop && pop.querySelector(".jr-popup-response");
    var hidden = document.querySelector("[data-jr-exp]") || [].slice.call(document.querySelectorAll("[data-turn-key]")).filter(function (t) { return getComputedStyle(t).display === "none"; }).pop();
    var root = r && r.firstElementChild;
    return { r: r, pop: pop, hidden: hidden, root: root };
  }
  function start() {
    if (on) return; on = true; t0 = performance.now(); P.rows = []; P.frames = []; last = "";
    (function loop() {
      var t = Math.round(performance.now() - t0), s = sample();
      var row = {
        hidden: !!s.hidden,
        mirror: s.r ? s.r.querySelectorAll("[data-start],[data-d-component],[data-markdown-text-style]").length > 0 : null,
        literalStars: s.r ? textNoCode(s.r).indexOf("**") !== -1 : null,
        root: s.root ? (String(s.root.className).split(" ").filter(function (c) { return /MarkdownRoot|Streaming/.test(c); }).join(".") + (s.root.hasAttribute("data-markdown-animated") ? "[animated]" : "")) : null,
        streaming: !!(s.pop && s.pop.classList.contains("jr-popup--streaming")),
      };
      var k = JSON.stringify(row);
      if (k !== last) { row.t = t; P.rows.push(row); last = k; }
      if (row.streaming || (s.hidden && t < 30000)) {
        var ha = anim(s.hidden), pa = anim(s.r);
        P.frames.push([t, s.hidden ? (s.hidden.textContent || "").length : -1, s.r ? (s.r.textContent || "").length : -1, ha[0], ha[1], pa[0], pa[1]]);
      }
      if (t < 60000) requestAnimationFrame(function () { setTimeout(loop, 0); }); else on = false;
    })();
  }
  window.__jrPath2Start = start;
  document.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey && !e.metaKey && e.target.closest && e.target.closest(".jr-popup")) start(); }, true);
  document.addEventListener("click", function (e) { if (e.target.closest && e.target.closest(".jr-popup-edit-send, .jr-send-mode-dropdown")) start(); }, true);
  return "path log v2 on";
})();

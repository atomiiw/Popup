// R36h observation (testing only; MAIN world via chrome_js.py @file, read-only): is a popup's newly arrived text
// painted at full ink before ChatGPT's per-word reveal (CSS highlights dil-word-N) covers it? Sampled after
// paint each frame while a popup streams: characters new this frame, how many of them no dil-word range covers,
// and the same for ChatGPT's hidden source turn. Read: JSON.stringify(window.__jrFade)
(function () {
  if (window.__jrFadeOn) return "already";
  window.__jrFadeOn = true;
  var F = window.__jrFade = { frames: [], sum: { newPop: 0, bareNewPop: 0, newSrc: 0, bareNewSrc: 0 } }, t0 = performance.now();
  function covered() {
    var set = new Set();
    if (window.CSS && CSS.highlights) CSS.highlights.forEach(function (hl, name) {
      if (!/^dil-word-/.test(name)) return;
      hl.forEach(function (r) {
        // a range inside one text node: mark its characters
        if (r.startContainer === r.endContainer && r.startContainer.nodeType === 3) {
          var n = r.startContainer; if (!n.__jrC) n.__jrC = {};
          for (var i = r.startOffset; i < r.endOffset; i++) set.add(n), (n.__jrC[i] = F.frames.length);
        } else set.add(r.startContainer);
      });
    });
    return set;
  }
  function texts(root) {
    var out = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) out.push(w.currentNode);
    return out;
  }
  function count(root, frameNo) {
    var nw = 0, bare = 0;
    texts(root).forEach(function (n) {
      var seen = n.__jrSeen || 0, len = n.data.length;
      for (var i = seen; i < len; i++) { nw++; if (!(n.__jrC && n.__jrC[i] === frameNo)) bare++; }
      n.__jrSeen = len;
    });
    return [nw, bare];
  }
  (function loop() {
    requestAnimationFrame(function () { setTimeout(function () {
      var pop = document.querySelector(".jr-popup--streaming .jr-popup-response");
      if (pop) {
        var fno = F.frames.length; covered();
        var p = count(pop, fno);
        var src = [].filter.call(document.querySelectorAll("[data-turn-key]"), function (t) { return getComputedStyle(t).display === "none"; }).pop();
        var s = src ? count(src, fno) : [0, 0];
        if (p[0] || s[0]) {
          F.frames.push({ t: Math.round(performance.now() - t0), newPop: p[0], bareNewPop: p[1], newSrc: s[0], bareNewSrc: s[1] });
          F.sum.newPop += p[0]; F.sum.bareNewPop += p[1]; F.sum.newSrc += s[0]; F.sum.bareNewSrc += s[1];
          if (F.frames.length > 600) F.frames.shift();
        } else F.frames.push({ t: 0 }) && F.frames.pop();
      }
      loop();
    }, 0); });
  })();
  return "fade log on";
})();

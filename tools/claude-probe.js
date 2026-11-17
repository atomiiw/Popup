// claude.ai read-only probe helpers (testing only; MAIN world via tools/chrome_js.py @file).
// Installs window.__cp with: answerDom(), rows(), hide(mode, n), unhide(), gapReport(), frameLog.
(function () {
  if (window.__cp) return "already";
  var ROW = "[data-testid=transcript-row]";
  function rows() { return [].slice.call(document.querySelectorAll(ROW)); }
  function desc(el) { return el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""); }
  var cp = window.__cp = {
    rows: function () {
      return rows().map(function (r) { var b = r.getBoundingClientRect(); var k = r.querySelector("[data-turn-key]");
        return { kind: r.getAttribute("data-perf-row"), key: k ? k.getAttribute("data-turn-key").slice(0, 12) : null, top: Math.round(b.top), h: Math.round(b.height), streaming: r.getAttribute("data-perf-row-streaming") }; });
    },
    answerDom: function () {
      var a = [].slice.call(document.querySelectorAll("[data-cds=AssistantMessage]")).pop();
      if (!a) return null;
      var prose = a.querySelector("[data-cds=Prose]") || a;
      var code = prose.querySelector("pre, .cm-editor, [class*=code-block]");
      var styleTags = [].slice.call(document.querySelectorAll("style")).filter(function (s) { return /cm-|katex|hljs|token/.test(s.textContent.slice(0, 2000)); }).length;
      return { katex: prose.querySelectorAll(".katex").length, katexDisplay: prose.querySelectorAll(".katex-display").length, mathml: prose.querySelectorAll("math").length,
        tables: prose.querySelectorAll("table").length, tableWrap: prose.querySelector("table") ? desc(prose.querySelector("table").parentElement) : null,
        pre: prose.querySelectorAll("pre").length, codeEl: code ? desc(code) : null, codeChildTags: code ? [].slice.call(code.querySelectorAll("*")).slice(0, 8).map(desc) : [],
        codeHasTokens: code ? code.querySelectorAll("span[class]").length : 0, codeWhiteSpace: code ? getComputedStyle(code.querySelector("code") || code).whiteSpace : null,
        statusLine: (a.querySelector("[data-cds=TurnStatus]") || {}).textContent || null, styleTagsWithCodeOrMath: styleTags,
        topLevel: [].slice.call(prose.children).slice(0, 12).map(desc), htmlLen: prose.innerHTML.length };
    },
    hide: function (mode, n) {
      cp.unhide();
      var decl = mode === "none" ? "display: none !important" : "height: 0 !important; min-height: 0 !important; overflow: hidden !important; pointer-events: none !important";
      var rs = rows(), sels = [], picked = 0;
      for (var i = 0; i + 1 < rs.length && picked < n; i += 2) {
        var k = rs[i].querySelector("[data-turn-key]"); if (!k) continue;
        var K = k.getAttribute("data-turn-key");
        sels.push(ROW + ":has([data-turn-key=\"" + K + "\"])", ROW + ":has([data-turn-key=\"" + K + "-hub-reply\"])");
        picked++;
      }
      var s = document.createElement("style"); s.id = "jr-cp-hide"; s.textContent = sels.join(",\n") + " { " + decl + " }";
      document.head.appendChild(s); cp.hidden = { mode: mode, n: picked }; return sels.length;
    },
    unhide: function () { var s = document.getElementById("jr-cp-hide"); if (s) s.remove(); cp.hidden = null; },
    // blank detector sampled after paint: largest vertical gap between consecutive visible rows inside the viewport
    startWatch: function () {
      cp.watch = { maxGap: 0, frames: 0, blanks: 0, t0: performance.now() };
      var sc = rows()[0] && rows()[0].closest("[class*=overflow-y]") ;
      (function loop() {
        if (!cp.watch || cp.watch.stopped) return;
        var vis = rows().filter(function (r) { var b = r.getBoundingClientRect(); return b.height > 0 && b.bottom > 0 && b.top < innerHeight; });
        vis.sort(function (a, b) { return a.getBoundingClientRect().top - b.getBoundingClientRect().top; });
        var gap = 0;
        for (var i = 1; i < vis.length; i++) gap = Math.max(gap, vis[i].getBoundingClientRect().top - vis[i - 1].getBoundingClientRect().bottom);
        if (vis.length === 0) gap = innerHeight;
        // blank above the first visible row (stale heights of hidden rows show up here when scrolled to the top)
        var sc = document.querySelector("[data-testid=transcript-row]") && document.querySelector("[data-testid=transcript-row]").closest("[style*=overflow], .overflow-y-auto, [class*=overflow-y-auto]");
        var firstTop = vis.length ? vis[0].getBoundingClientRect().top : innerHeight;
        cp.watch.maxFirstTop = Math.max(cp.watch.maxFirstTop || 0, Math.round(firstTop));
        cp.watch.frames++; if (gap > 80) cp.watch.blanks++; cp.watch.maxGap = Math.max(cp.watch.maxGap, Math.round(gap));
        requestAnimationFrame(function () { setTimeout(loop, 0); });
      })();
      return "watching";
    },
    stopWatch: function () { if (!cp.watch) return null; cp.watch.stopped = true; var w = cp.watch; return { frames: w.frames, blanksOver80px: w.blanks, maxGapPx: w.maxGap, maxFirstRowTopPx: w.maxFirstTop, seconds: Math.round((performance.now() - w.t0) / 1000) }; },
    trace: function () { var t = window.__rsTrace || []; var c = {}; t.forEach(function (e) { var k = (e && (e.type || e.kind || e[0])) || "?"; c[k] = (c[k] || 0) + 1; }); return { n: t.length, kinds: c }; },
  };
  return "claude probe on";
})();

// Popup send recorder (testing only; injected with tools/chrome_js.py, page MAIN world).
// Arms on a send from a popup (Enter in a popup question, or a click on its send arrow / mode
// menu) and records 12 s, one row per frame: chat scrollTop, popup + highlight positions,
// focus; plus ChatGPT's own programmatic scrolls of the thread (with a short stack).
// Read back: JSON.stringify(window.__jrRec)
(function () {
  if (window.__jrRecInstalled) return "already";
  window.__jrRecInstalled = true;
  window.__jrRec = [];
  var SC = "[data-app-action-timeline-scroll]";
  var cur = null;
  function r(el) { if (!el || !el.isConnected) return null; var b = el.getBoundingClientRect(); return Math.round(b.top); }
  function desc(el) { if (!el) return null; return el.tagName + (el.className && typeof el.className === "string" ? "." + el.className.split(" ").slice(0, 2).join(".") : "") + (el.getAttribute && el.getAttribute("aria-label") ? "[" + el.getAttribute("aria-label") + "]" : ""); }
  function snap(tag) {
    var sc = document.querySelector(SC);
    var pops = document.querySelectorAll(".jr-popup");
    var pop = pops[pops.length - 1];
    // the root highlight: the one whose text the test highlighted (window.__jrRecText), else the active one
    var want = window.__jrRecText;
    var hl = want ? [].slice.call(document.querySelectorAll(".jr-source-highlight, .jr-source-highlight-done")).filter(function (e) { return e.textContent && want.indexOf(e.textContent.trim()) !== -1 && e.textContent.trim(); })[0]
                  : document.querySelector(".jr-source-highlight");
    return { t: Math.round(performance.now() - cur.t0), tag: tag, st: sc ? Math.round(sc.scrollTop) : null, sh: sc ? sc.scrollHeight : null,
      pop: r(pop), popTopCss: pop ? pop.style.top : null, popIn: pop ? pop.isConnected : false, popH: pop ? pop.offsetHeight : null,
      hl: r(hl), turns: document.querySelectorAll("[data-turn-key]").length, lock: document.documentElement.getAttribute("data-jr-scroll-lock") !== null, focus: desc(document.activeElement) };
  }
  function start(how) {
    if (cur && performance.now() - cur.t0 < 12000) return;
    cur = { how: how, t0: performance.now(), rows: [], scrolls: [], last: null };
    window.__jrRec.push(cur);
    cur.rows.push(snap("start:" + how));
    (function loop() {
      if (performance.now() - cur.t0 > 12000) { cur.rows.push(snap("end")); cur.done = true; return; }
      var s = snap("");
      var k = JSON.stringify([s.st, s.sh, s.pop, s.hl, s.popIn, s.popH, s.focus, s.lock, s.turns]);
      if (k !== cur.last) { cur.rows.push(s); cur.last = k; }
      requestAnimationFrame(function () { setTimeout(loop, 0); }); // sample after paint: what the user saw
    })();
  }
  window.__jrRecStart = start; // manual start (experiments)
  document.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && e.target.closest && e.target.closest(".jr-popup")) start("Enter");
  }, true);
  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest(".jr-popup-edit-send, .jr-send-mode-dropdown")) start("click");
    if (e.target.closest && e.target.closest(".jr-retry-btn")) start("retry");
  }, true);
  document.addEventListener("focusin", function (e) { if (cur && !cur.done) cur.rows.push(snap("focusin " + desc(e.target))); }, true);
  // ChatGPT's own scroll calls (main world). scroll-guard.js may swallow them while locked; we log either way.
  var P = Element.prototype;
  function logScroll(name, el) {
    if (!cur || cur.done || !el.matches || !(el.matches(SC) || (name === "scrollIntoView" && el.closest && el.closest(SC)))) return;
    cur.scrolls.push({ t: Math.round(performance.now() - cur.t0), fn: name, el: desc(el), lock: document.documentElement.getAttribute("data-jr-scroll-lock") !== null,
      stack: (new Error().stack || "").split("\n").slice(2, 5).map(function (s) { return s.trim().slice(0, 140); }).join(" | ") });
  }
  ["scrollTo", "scroll", "scrollBy", "scrollIntoView"].forEach(function (n) {
    var o = P[n]; P[n] = function () { logScroll(n, this); return o.apply(this, arguments); };
  });
  var d = Object.getOwnPropertyDescriptor(P, "scrollTop");
  Object.defineProperty(P, "scrollTop", { configurable: true, enumerable: d.enumerable, get: d.get,
    set: function (v) { logScroll("scrollTop=" + Math.round(v), this); d.set.call(this, v); } });
  return "installed";
})();

// R36a observation (testing only; MAIN world via chrome_js.py @file, read-only): every programmatic scroll
// ChatGPT makes on the thread scroller (scrollTo/scroll/scrollBy/scrollIntoView/scrollTop=, even ones
// scroll-guard blocks) and every scroll event with the resulting scrollTop, for 3 s after window.__jrScStart().
// Popup's own writes run in the isolated world and show only as scroll events with no call before them.
// Read: JSON.stringify(window.__jrSc)
(function () {
  if (window.__jrScOn) return "already";
  window.__jrScOn = true;
  var SC = /claude\.ai/.test(location.hostname) ? "[data-autoscroll-container]" : /deepseek/.test(location.hostname) ? ".ds-virtual-list" : "[data-app-action-timeline-scroll]", L = window.__jrSc = { ev: [] }, t0 = 0, on = false;
  function now() { return Math.round(performance.now() - t0); }
  function stack() { return String(new Error().stack).split("\n").slice(3, 6).map(function (s) { return s.trim().replace(/https:\/\/[^ )]+\//g, "").slice(0, 60); }).join(" < "); }
  function log(o) { if (on && L.ev.length < 1500) { o.t = now(); o.lock = document.documentElement.hasAttribute("data-jr-scroll-lock"); L.ev.push(o); } }
  var P = Element.prototype;
  ["scrollTo", "scroll", "scrollBy"].forEach(function (n) {
    var orig = P[n];
    P[n] = function (a, b) { if (this.matches && this.matches(SC)) log({ call: n, arg: typeof a === "object" ? JSON.stringify(a) : a + "," + b, st: this.scrollTop, by: stack() }); return orig.apply(this, arguments); };
  });
  var iv = P.scrollIntoView;
  P.scrollIntoView = function () { if (this.closest && this.closest(SC)) log({ call: "intoView", el: (this.getAttribute("data-turn-key") || this.tagName).slice(0, 8), by: stack() }); return iv.apply(this, arguments); };
  var d = Object.getOwnPropertyDescriptor(P, "scrollTop");
  Object.defineProperty(P, "scrollTop", { configurable: true, get: d.get, set: function (v) { if (this.matches && this.matches(SC)) log({ call: "scrollTop=", arg: Math.round(v), st: d.get.call(this), by: stack() }); return d.set.call(this, v); } });
  document.addEventListener("scroll", function (e) { if (e.target.matches && e.target.matches(SC)) log({ ev: "scroll", st: Math.round(e.target.scrollTop) }); }, true);
  window.__jrScStart = function (ms) { t0 = performance.now(); L.ev = []; on = true; setTimeout(function () { on = false; }, ms || 3000); };
  document.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey && e.target.closest && e.target.closest(".jr-popup")) window.__jrScStart(window.__jrScMs); }, true);
  return "scroll-call log on";
})();

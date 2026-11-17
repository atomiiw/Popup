// Send snapshot (testing only; MAIN world, via tools/cdp.js eval @file). Measures what ChatGPT's thread
// does after a Popup send, one row per changed frame for 2.5 s: scroll position, the virtual list's
// total height and window, every mounted turn (top/height), ChatGPT's reading-anchor state, the response
// spacer, the "loading older" row, and each ChatGPT scroll call with its target.
// Arms on Return / send-arrow click in a popup (or window.__jrSnapStart()). Read back: JSON.stringify(window.__jrSnap)
(function () {
  if (window.__jrSnapInstalled) return "already";
  window.__jrSnapInstalled = true;
  var SC = "[data-app-action-timeline-scroll]", CONV = "[data-thread-find-target=conversation]";
  var snap = window.__jrSnap = { props: null, before: null, frames: [], scrolls: [] };
  var t0 = 0, on = false, last = "", ids = new WeakMap(), nextId = 0;
  function round(v) { return Math.round(v); }
  function q(s) { return document.querySelector(s); }
  function frame() {
    var sc = q(SC), conv = q(CONV);
    if (!sc || !conv) return { err: "no scroller" };
    var list = conv.querySelector(":scope > .relative.shrink-0") || conv.children[2];
    var inner = list && list.firstElementChild;
    var scTop = sc.getBoundingClientRect().top;
    var pass = sc.querySelector("[data-thread-reading-passage]");
    var spacer = conv.querySelector(":scope > .shrink-0:last-child");
    var status = conv.querySelector("[role=status]");
    return {
      st: round(sc.scrollTop), sh: sc.scrollHeight,
      reading: sc.getAttribute("data-thread-reading"), hasPassage: sc.hasAttribute("data-thread-has-reading-passage"),
      passage: pass ? (pass.textContent || "").slice(0, 14) + " @" + round(pass.getBoundingClientRect().top - scTop) : null,
      listH: list ? round(list.getBoundingClientRect().height) : null, listStyle: list ? list.getAttribute("style") : null,
      innerH: inner ? round(inner.getBoundingClientRect().height) : null, innerStyle: inner ? inner.getAttribute("style") : null,
      // per turn: key:top/height, #element id (a new id = React made a new element), text length, content-visibility
      turns: [].slice.call(conv.querySelectorAll("[data-turn-key]")).map(function (t) {
        var r = t.getBoundingClientRect(), cs = getComputedStyle(t);
        if (!ids.has(t)) ids.set(t, ++nextId);
        var cv = cs.contentVisibility && cs.contentVisibility !== "visible" ? "/cv:" + cs.contentVisibility : "";
        return t.getAttribute("data-turn-key").slice(0, 4) + ":" + round(r.top - scTop) + "/" + round(r.height) + "#" + ids.get(t) + "/txt" + (t.textContent || "").length + cv + (cs.display === "none" ? "/hidden" : "");
      }).join(" "),
      spacerH: spacer ? round(spacer.getBoundingClientRect().height) : null,
      status: status ? (status.textContent || "").slice(0, 24) : null,
      tail: document.documentElement.classList.contains("jr-tail-hidden"),
      lock: document.documentElement.hasAttribute("data-jr-scroll-lock"),
    };
  }
  // The thread component's React props (primitive values only): what ChatGPT configured.
  function props() {
    var sc = q(SC); if (!sc) return null;
    var k = Object.keys(sc).find(function (k) { return k.indexOf("__reactFiber") === 0; });
    var f = k && sc[k], out = [];
    for (var i = 0; f && i < 40; i++, f = f.return) {
      var p = f.memoizedProps;
      if (p && typeof p === "object" && ("preserveReadingPassage" in p || "followContentGrowth" in p || "loadPastHiddenHistoryPages" in p || "scrollOrigin" in p)) {
        var o = {}; Object.keys(p).forEach(function (n) { var v = p[n]; if (v === null || /^(string|number|boolean|undefined)$/.test(typeof v)) o[n] = v; else o[n] = typeof v; });
        out.push(o);
      }
    }
    return out;
  }
  function start(how) {
    if (on) return;
    // fresh arrays each send: without a reload (RELOAD=0) the script stays installed and earlier sends' frames piled up
    on = true; t0 = performance.now(); snap.how = how; snap.frames.length = 0; snap.scrolls.length = 0; snap.done = false; snap.props = props(); snap.before = frame(); last = "";
    (function loop() {
      var t = round(performance.now() - t0);
      var f = frame(), k = JSON.stringify(f);
      if (k !== last) { f.t = t; snap.frames.push(f); last = k; }
      if (t < 2500) requestAnimationFrame(function () { setTimeout(loop, 0); }); else { on = false; snap.done = true; } // after paint
    })();
  }
  window.__jrSnapStart = start;
  document.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey && !e.metaKey && e.target.closest && e.target.closest(".jr-popup")) start("Enter"); }, true);
  document.addEventListener("click", function (e) { if (e.target.closest && e.target.closest(".jr-popup-edit-send, .jr-send-mode-dropdown")) start("click"); }, true);
  // ChatGPT's own scroll calls on the thread (blocked or not), with their target
  var P = Element.prototype;
  function log(fn, el, arg) {
    if (!on || !el.matches || !el.matches(SC)) return;
    snap.scrolls.push({ t: round(performance.now() - t0), fn: fn, arg: arg, st: round(el.scrollTop), sh: el.scrollHeight });
  }
  ["scrollTo", "scroll"].forEach(function (n) { var o = P[n]; P[n] = function (a, b) { log(n, this, typeof a === "object" ? JSON.stringify(a) : a + "," + b); return o.apply(this, arguments); }; });
  var d = Object.getOwnPropertyDescriptor(P, "scrollTop");
  Object.defineProperty(P, "scrollTop", { configurable: true, enumerable: d.enumerable, get: d.get, set: function (v) { log("scrollTop=", this, round(v)); d.set.call(this, v); } });
  return "installed";
})();

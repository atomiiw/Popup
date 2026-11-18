// scroll-guard.js — Runs in the page's MAIN world (see manifest).
//
// While Popup sends a hidden question, the site (ChatGPT, DeepSeek, claude.ai) scrolls the new turn into
// view. Content scripts live in an isolated world, so they
// cannot stop the page's own scroll calls; this script can. When <html> has
// data-jr-scroll-lock, programmatic scrolls of the conversation's scroll
// container are ignored. User scrolling (wheel, keys, scrollbar) never goes
// through these APIs and is unaffected. Popup's own scroll restore runs in the
// isolated world, where these patches don't apply.
(function () {
  "use strict";

  // The thread scroller per site; keep in sync with site-adapter.js C.scrollContainer[0], sites/deepseek.js, sites/claude.js
  var h = location.hostname;
  var SCROLLER = /(^|\.)chat\.deepseek\.com$/.test(h) ? ".ds-virtual-list"
    : /(^|\.)claude\.ai$/.test(h) ? "[data-autoscroll-container]"
    : "[data-app-action-timeline-scroll]";

  // The attribute holds the time the lock was set; a lock older than 2 minutes
  // is ignored, so a missed unlock can never leave ChatGPT unable to scroll.
  function lockOn() {
    var t = document.documentElement.getAttribute("data-jr-scroll-lock");
    return t !== null && Date.now() - Number(t) < 120000;
  }

  function isThreadScroller(el) {
    return !!(el && el.matches && el.matches(SCROLLER));
  }

  // What was blocked (testing): the last 30 calls in #jr-scrolllog[data-json] — on the page, so DOM-only tools can read it
  var blocked = [];
  function note(what, arg) {
    blocked.push({ t: Math.round(performance.now()), what: what, arg: String(arg === undefined ? "" : typeof arg === "object" ? JSON.stringify(arg) : arg).slice(0, 80),
      by: String(new Error().stack).split("\n").slice(3, 5).map(function (l) { return l.trim().slice(0, 90); }).join(" < ") });
    if (blocked.length > 30) blocked.shift();
    var el = document.getElementById("jr-scrolllog");
    if (!el && document.body) { el = document.createElement("div"); el.id = "jr-scrolllog"; el.hidden = true; document.body.appendChild(el); }
    if (el) el.setAttribute("data-json", JSON.stringify(blocked));
  }

  // ChatGPT: while a Popup send holds the view, ChatGPT's list is told its viewport is one screen taller. Its list
  // draws the turns from the distance-from-bottom over one viewport (+1 turn); a new turn at the bottom counts at an
  // estimated height until measured (0 px: hidden), which slides that range down for a moment, and the top drawn turns
  // were unmounted and re-mounted as blank placeholders — on screen when the reader is mid-chat (R36a residual,
  // 2026-11-18). One screen more above keeps that edge off screen. ChatGPT reads the viewport height from its
  // ResizeObserver entries (borderBoxSize, else contentRect); its observer of the thread scroller gets one entry with
  // the taller size when the lock starts and the true one when it ends. (Its tail spacer, sized from it, is collapsed
  // during the send: html.jr-tail-hidden.)
  if (!/(^|\.)chat\.deepseek\.com$|(^|\.)claude\.ai$/.test(h) && window.ResizeObserver) {
    var NativeRO = window.ResizeObserver, watched = [];
    window.ResizeObserver = function (cb) {
      var obs = new NativeRO(cb);
      obs.observe = function (target, opts) {
        if (isThreadScroller(target)) watched.push({ el: target, cb: cb, obs: obs });
        return NativeRO.prototype.observe.call(this, target, opts);
      };
      return obs;
    };
    window.ResizeObserver.prototype = NativeRO.prototype;
    var tell = function (taller) {
      watched = watched.filter(function (w) { return w.el.isConnected; });
      watched.forEach(function (w) {
        var el = w.el, r = el.getBoundingClientRect(), add = taller ? el.clientHeight : 0;
        var entry = { target: el,
          contentRect: { x: 0, y: 0, top: 0, left: 0, width: el.clientWidth, height: el.clientHeight + add, right: el.clientWidth, bottom: el.clientHeight + add },
          borderBoxSize: [{ inlineSize: r.width, blockSize: r.height + add }],
          contentBoxSize: [{ inlineSize: el.clientWidth, blockSize: el.clientHeight + add }] };
        try { w.cb.call(w.obs, [entry], w.obs); } catch (e) { /* its callback, its problem */ }
      });
    };
    var wasLocked = false;
    new MutationObserver(function () {
      var on = lockOn();
      if (on !== wasLocked) { wasLocked = on; tell(on); }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-jr-scroll-lock"] });
  }

  var P = Element.prototype;

  ["scrollTo", "scroll", "scrollBy"].forEach(function (name) {
    var orig = P[name];
    if (typeof orig !== "function") return;
    P[name] = function () {
      if (lockOn() && isThreadScroller(this)) return note(name, arguments[0]);
      return orig.apply(this, arguments);
    };
  });

  var origIntoView = P.scrollIntoView;
  P.scrollIntoView = function () {
    if (lockOn() && this.closest && this.closest(SCROLLER)) return note("intoView", (this.getAttribute && this.getAttribute("data-turn-key")) || this.tagName);
    return origIntoView.apply(this, arguments);
  };

  var desc = Object.getOwnPropertyDescriptor(P, "scrollTop");
  if (desc && desc.set && desc.configurable) {
    Object.defineProperty(P, "scrollTop", {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set: function (v) {
        if (lockOn() && isThreadScroller(this)) return note("scrollTop=", Math.round(v));
        desc.set.call(this, v);
      },
    });
  }
})();

// scroll-guard.js — Runs in the page's MAIN world (see manifest).
//
// While Popup sends a hidden question, ChatGPT tries to scroll the new turn to
// the top of the thread. Content scripts live in an isolated world, so they
// cannot stop the page's own scroll calls; this script can. When <html> has
// data-jr-scroll-lock, programmatic scrolls of the conversation's scroll
// container are ignored. User scrolling (wheel, keys, scrollbar) never goes
// through these APIs and is unaffected. Popup's own scroll restore runs in the
// isolated world, where these patches don't apply.
(function () {
  "use strict";

  var SCROLLER = "[data-app-action-timeline-scroll]"; // keep in sync with site-adapter.js candidates.scrollContainer[0]

  // The attribute holds the time the lock was set; a lock older than 2 minutes
  // is ignored, so a missed unlock can never leave ChatGPT unable to scroll.
  function lockOn() {
    var t = document.documentElement.getAttribute("data-jr-scroll-lock");
    return t !== null && Date.now() - Number(t) < 120000;
  }

  function isThreadScroller(el) {
    return !!(el && el.matches && el.matches(SCROLLER));
  }

  var P = Element.prototype;

  ["scrollTo", "scroll", "scrollBy"].forEach(function (name) {
    var orig = P[name];
    if (typeof orig !== "function") return;
    P[name] = function () {
      if (lockOn() && isThreadScroller(this)) return;
      return orig.apply(this, arguments);
    };
  });

  var origIntoView = P.scrollIntoView;
  P.scrollIntoView = function () {
    if (lockOn() && this.closest && this.closest(SCROLLER)) return;
    return origIntoView.apply(this, arguments);
  };

  var desc = Object.getOwnPropertyDescriptor(P, "scrollTop");
  if (desc && desc.set && desc.configurable) {
    Object.defineProperty(P, "scrollTop", {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set: function (v) {
        if (lockOn() && isThreadScroller(this)) return;
        desc.set.call(this, v);
      },
    });
  }
})();

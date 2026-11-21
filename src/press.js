// press.js — Whose press, click or key is this: one rule for the whole extension (user 11-21: "这整个鼠标检测鼠标clicking
// 太乱了"; audit 11-21: it was answered in ~12 places — _jrPressed checks, a stopPropagation on each button, composedPath
// tests, detail > 1, the scrollbar offset). Popup's code asks JR.press.of(e); Popup's own UI keeps its presses from the
// site with JR.press.mine(root) — once per root, not per button.
(function () {
  "use strict";

  var OPENED = ".jr-site-overlay, [data-jr-site-opened]"; // what the site opened for a popup's control (site-control.js)
  var CONTROL = ".jr-toolbar-delete, .jr-retry-btn, .jr-reply-whole-btn"; // a popup's own buttons

  /**
   * e (a pointer, mouse, click or key event) → { owner, popup?, el?, response? }:
   *   "synthetic"   Popup's own press for a site control (site-control.js): no press of the user's — not outside a
   *                 popup, not scrolling the chat, not a key of the page
   *   "lightbox"    in the image viewer (over the whole window while open: every press is its)
   *   "site-opened" in what the site opened for a popup's control (a menu shown by Popup, a dialog on the page): el
   *   "ask"         the ask button; "nav" the ∧ ∨ widget
   *   "control"     a popup's own button (trash, Try again, Retry, Reply): popup, el
   *   "site-control" a control the site drew in a popup's answer (a button, an entity link — in a shadow root too):
   *                 popup, el, response
   *   "popup"       anywhere else in a popup: popup
   *   "repeat"      the second click of a double-click (the first one decided)
   *   "scrollbar"   on a scrollbar (scrolling, not a press on the page)
   *   "outside"     everything else
   * The path, not e.target: sending removes the question box before the event gets to the document (R33).
   */
  function of(e) {
    if (e._jrPressed) return { owner: "synthetic" };
    var path = e.composedPath ? e.composedPath() : [e.target], el = null, site = null, response = null;
    for (var i = 0; i < path.length; i++) {
      var n = path[i];
      if (!n || n.nodeType !== 1) continue;
      if (n.classList.contains("jr-lightbox")) return { owner: "lightbox" }; // (over the whole window while open)
      if (n.matches(OPENED)) return { owner: "site-opened", el: n };
      if (n.classList.contains("jr-highlight-trigger-btn")) return { owner: "ask" };
      if (n.classList.contains("jr-nav-widget")) return { owner: "nav" };
      if (!el && n.matches(CONTROL)) el = n;
      if (!site && !response && n.matches(siteSelector())) site = n;
      if (!response && n.classList.contains("jr-popup-response")) response = n;
      if (n.classList.contains("jr-popup")) return inPopup(n);
    }
    if (el || response) return inPopup(null); // (an answer area not in a popup: tests)
    function inPopup(popup) {
      if (el) return { owner: "control", popup: popup, el: el };
      if (site && response) return { owner: "site-control", popup: popup, el: site, response: response };
      return { owner: "popup", popup: popup };
    }
    if (e.detail > 1) return { owner: "repeat" };
    var t = e.target;
    if (t && t.clientWidth && (e.offsetX > t.clientWidth || e.offsetY > t.clientHeight)) return { owner: "scrollbar" };
    return { owner: "outside" };
  }
  function siteSelector() {
    var ent = JR.site && JR.site.entitySelector;
    return "button, [role=button]" + (ent ? ", " + ent : "");
  }

  /** Presses in root (Popup's UI) are Popup's: the site's listeners up the page don't get them. */
  function mine(root) {
    if (root._jrMine) return root;
    root._jrMine = true;
    function stop(e) { e.stopPropagation(); }
    root.addEventListener("mousedown", stop);
    root.addEventListener("mouseup", stop);
    return root;
  }

  JR.press = { of: of, mine: mine };
})();

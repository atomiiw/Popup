// site-overlay.js — Using a site's control in a popup, one way for every site and control (GLOSSARY.md: site answer,
// original, copy): the control in the original is pressed as a pointer presses it (menus open on pointerdown), and what
// the site opens for it in another document — the hidden copy of the chat holding the original: a menu, a dialog, an
// editor added to that document's body — is shown in the page next to the control in the popup, kept in step with it,
// and used as the site's own (user 11-20: a generated image's Edit / Share opened unseen in the hidden copy).
(function () {
  "use strict";

  /** Press el as a pointer does: down, up, then the click (a site's menu may open on pointerdown, a button on click). */
  function press(el) {
    var w = el.ownerDocument.defaultView, r = el.getBoundingClientRect();
    var o = { bubbles: true, cancelable: true, composed: true, view: w, button: 0, buttons: 1,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1, pointerType: "mouse", isPrimary: true };
    if (w.PointerEvent) el.dispatchEvent(new w.PointerEvent("pointerdown", o));
    el.dispatchEvent(new w.MouseEvent("mousedown", o));
    o.buttons = 0;
    if (w.PointerEvent) el.dispatchEvent(new w.PointerEvent("pointerup", o));
    el.dispatchEvent(new w.MouseEvent("mouseup", o));
    el.click();
  }

  /** el's place under root as child indexes, or null. */
  function pathOf(root, el) {
    var p = [];
    for (var n = el; n && n !== root; n = n.parentElement) p.unshift(Array.prototype.indexOf.call(n.parentElement.children, n));
    return n === root ? p : null;
  }
  function atPath(root, p) {
    var n = root;
    for (var i = 0; n && i < p.length; i++) n = n.children[p[i]];
    return n || null;
  }

  var open = []; // { orig, close }

  /** Show orig (an element the site added to doc's body) in the page, where it is to origCtrl as copyCtrl is in the page. */
  function show(orig, doc, copyCtrl, origCtrl) {
    var cr = copyCtrl.getBoundingClientRect(), or = origCtrl.getBoundingClientRect(), fw = doc.defaultView;
    var wrap = document.createElement("div");
    wrap.className = "jr-site-overlay";
    // (a frame of the copy's size, moved by where the control is: what the site places in its viewport lands by the
    // control in the popup — a transform makes it the containing block of the site's fixed elements)
    wrap.style.setProperty("--jr-ov-x", (cr.left - or.left) + "px");
    wrap.style.setProperty("--jr-ov-y", (cr.top - or.top) + "px");
    wrap.style.setProperty("--jr-ov-w", fw.innerWidth + "px");
    wrap.style.setProperty("--jr-ov-h", fw.innerHeight + "px");
    var copy = orig.cloneNode(true);
    wrap.appendChild(copy);
    document.body.appendChild(wrap);
    var obs = new MutationObserver(function () {
      if (!orig.isConnected) return close();
      JR.siteAnswer.mirror(orig, copy);
    });
    obs.observe(orig, { subtree: true, childList: true, attributes: true, characterData: true });
    var gone = new MutationObserver(function () { if (!orig.isConnected) close(); });
    gone.observe(doc.body, { childList: true });
    // used as the site's own: a click in it goes to the same place in the original
    wrap.addEventListener("click", function (e) {
      var p = pathOf(copy, e.target.nodeType === 1 ? e.target : e.target.parentElement), t = p && atPath(orig, p);
      if (!t) return;
      e.preventDefault(); e.stopPropagation();
      forward(t, e.target);
    }, true);
    // away from it, or Esc: as on the site (Esc to its document)
    function escape() { doc.dispatchEvent(new fw.KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true })); }
    function away(e) { if (!wrap.contains(e.target)) { escape(); setTimeout(function () { if (orig.isConnected) close(); }, 300); } }
    function key(e) { if (e.key === "Escape") { e.stopPropagation(); escape(); } }
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", key, true);
    function close() {
      obs.disconnect(); gone.disconnect(); wrap.remove();
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", key, true);
      open = open.filter(function (x) { return x.orig !== orig; });
    }
    open.push({ orig: orig, close: close });
  }

  /**
   * Use original control o for copyCtrl (its copy in a popup): pressed in its own document; anything the site adds to
   * that document's body for it within 1.5 s is shown in the page (only when that document isn't the page's).
   */
  function forward(o, copyCtrl) {
    var doc = o.ownerDocument;
    if (doc === document || !doc.body) { press(o); return; }
    var before = new Set(Array.prototype.slice.call(doc.body.children)), t0 = Date.now();
    press(o);
    (function look() {
      var added = Array.prototype.filter.call(doc.body.children, function (c) {
        return !before.has(c) && !/^(SCRIPT|STYLE|LINK|IFRAME)$/.test(c.tagName) && !open.some(function (x) { return x.orig === c; });
      });
      var drawn = added.filter(function (c) { var r = c.getBoundingClientRect(); return r.width || r.height || c.querySelector("*"); });
      if (drawn.length) { drawn.forEach(function (c) { show(c, doc, copyCtrl, o); }); return; }
      if (Date.now() - t0 < 1500) setTimeout(look, 50);
    })();
  }

  JR.siteOverlay = { forward: forward, press: press };
})();

// site-control.js — Using a site's control in a popup, one way for every site and control (GLOSSARY.md: site answer,
// original, copy; overnight plan A2 — was spread over popup.js, site-answer.js and site-overlay.js): the control in the
// original, found once it is there (a copy shown from memory: looked for first), is pressed as a pointer presses it (menus open on pointerdown), and what
// the site opens for it in another document — the hidden copy of the chat holding the original: a menu, a dialog, an
// editor added to that document's body — is shown in the page next to the control in the popup, kept in step with it,
// and used as the site's own (user 11-20: a generated image's Edit / Share opened unseen in the hidden copy).
(function () {
  "use strict";

  /** el gets ev, marked as Popup's (_jrPressed: not the user's press outside a popup, nor the user scrolling, nor a key
   *  of the page's — content.js, chat.js markUser, site-render.js guardFocus). */
  function send(el, ev) { ev._jrPressed = true; el.dispatchEvent(ev); }

  /** Press el as a pointer does: down, up, then the click (a site's menu may open on pointerdown, a button on click). */
  function press(el) {
    var w = el.ownerDocument.defaultView, r = el.getBoundingClientRect();
    var o = { bubbles: true, cancelable: true, composed: true, view: w, button: 0, buttons: 1,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1, pointerType: "mouse", isPrimary: true };
    if (w.PointerEvent) send(el, new w.PointerEvent("pointerdown", o));
    send(el, new w.MouseEvent("mousedown", o));
    o.buttons = 0;
    if (w.PointerEvent) send(el, new w.PointerEvent("pointerup", o));
    send(el, new w.MouseEvent("mouseup", o));
    el.click();
  }

  /**
   * An original on the page sits in a turn Popup hides (visibility: hidden, 0 px — site-hosts.js): its text is no
   * element's innerText there, so the site's Copy copied nothing (live NT1, DeepSeek). For the press, that turn is
   * rendered but transparent (still 0 px: nothing shows) — styles.css [data-jr-pressing]. Returns it, or null.
   */
  function reveal(el) {
    for (var n = el; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).visibility !== "hidden") continue;
      var up = n.parentElement;
      if (up && getComputedStyle(up).visibility === "hidden") continue;
      n.setAttribute("data-jr-pressing", "");
      return n;
    }
    return null;
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
    // a press in it is no press outside the popup (content.js closes the popups on one)
    function inside(e) { e.stopPropagation(); }
    wrap.addEventListener("mousedown", inside);
    wrap.addEventListener("pointerdown", inside);
    // away from it, or Esc (escape-guard.js: "jr-escape" — this first, the popup stays): as on the site, Esc to its document
    function escape() { send(doc, new fw.KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true })); }
    function away(e) { if (!e._jrPressed && !wrap.contains(e.target)) { escape(); setTimeout(function () { if (orig.isConnected) close(); }, 300); } }
    function key(e) { e.stopImmediatePropagation(); escape(); close(); }
    document.addEventListener("pointerdown", away, true);
    window.addEventListener("jr-escape", key, true);
    function close() {
      obs.disconnect(); gone.disconnect(); wrap.remove();
      document.removeEventListener("pointerdown", away, true);
      window.removeEventListener("jr-escape", key, true);
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
    if (doc === document || !doc.body) {
      var shown = doc === document && reveal(o), had = new Set(Array.prototype.slice.call(document.body.children));
      press(o);
      if (shown) setTimeout(function () { shown.removeAttribute("data-jr-pressing"); }, 1000); // (a Copy may read a moment later)
      // a menu the site opened for an original hidden on the page: placed by its 0 px trigger, unseen, and a modal one
      // takes the page's pointer (Radix: body pointer-events none — no hover anywhere): closed again (audit)
      if (shown) setTimeout(function () {
        var opened = Array.prototype.some.call(document.body.children, function (c) {
          return !had.has(c) && !/^(SCRIPT|STYLE|LINK)$/.test(c.tagName) && !c.classList.contains("jr-site-overlay") && !c.closest(".jr-popup");
        });
        if (opened) send(document, new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true }));
        if (document.body.style.pointerEvents === "none") document.body.style.pointerEvents = "";
      }, 300);
      return;
    }
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

  /**
   * The user clicked el, a site control in responseDiv (the live copy): its original pressed when it is there (looked
   * for up to 4 s; 20 s for a copy from memory — its original is looked for first), the hidden copy's document lent the
   * focus for the moment (a site's Copy writes the clipboard only from a focused document — site-render.js).
   */
  var lastInput = 0; // the user's last press or key (trusted)
  document.addEventListener("pointerdown", function (e) { if (e.isTrusted) lastInput = Date.now(); }, true);
  document.addEventListener("keydown", function (e) { if (e.isTrusted) lastInput = Date.now(); }, true);
  function use(el, responseDiv) {
    var memory = JR.siteAnswer.fromMemory(), at = Date.now();
    (function attempt(tries) {
      var o = JR.siteAnswer.current() === responseDiv && JR.siteAnswer.counterpart(el);
      if (!o) {
        if (tries > 0 && JR.siteAnswer.current() === responseDiv) setTimeout(function () { attempt(tries - 1); }, 100);
        return;
      }
      // found late, after the user went on (typed, pressed elsewhere) or 5 s on (a site's Copy needs the click's
      // activation): not pressed — the focus lent to the hidden copy took their keys, a menu opened out of nowhere (audit)
      if (Date.now() - at > 200 && (lastInput > at + 50 || Date.now() - at > 5000)) return;
      var w = o.ownerDocument.defaultView;
      if (w && w !== window) {
        if (JR.siteOriginalFocus) JR.siteOriginalFocus(500);
        // the control itself, not the frame's own focused composer: a key meanwhile goes nowhere (review)
        try { o.focus({ preventScroll: true }); } catch (er) {}
        var fd = o.ownerDocument;
        if (fd.activeElement !== o) { try { w.focus(); if (fd.activeElement && fd.activeElement !== fd.body) fd.activeElement.blur(); } catch (er) {} }
      }
      forward(o, el);
    })(memory ? 200 : 40);
  }

  /** The pointer came to el, a site control in responseDiv: a copy from memory starts looking for its original now. */
  function warm(el, responseDiv) {
    if (JR.siteAnswer.current() === responseDiv && JR.siteAnswer.fromMemory()) JR.siteAnswer.counterpart(el);
  }

  /** Close every site menu shown here (the hidden copy dropped: their originals went with it — audit). */
  function closeAll() { open.slice().forEach(function (x) { x.close(); }); }

  JR.siteControl = { use: use, warm: warm, forward: forward, closeAll: closeAll };
})();

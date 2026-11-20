// site-answer.js — A popup shows the site answer (GLOSSARY.md): a copy kept in step with its original.
//
// One way for every path (streaming, just done, after a reload, version switch, edit — user, 2026-11-18, design A):
// the active popup's answer area follows one live original, patched node by node (nothing flashes), so whatever the
// site draws there — new formats, new buttons, its own changes after a click — shows in the popup without Popup
// knowing about it. Only the active popup is live (DeepSeek draws one kept item, the frame scrolls to one turn);
// a parent keeps its last copy until it is active again. No original yet: the caller keeps "Loading…". Nothing stored.
(function () {
  "use strict";

  function sameKind(a, b) {
    return a.nodeType === b.nodeType && (a.nodeType !== 1 || a.tagName === b.tagName);
  }

  function syncAttrs(src, dst) {
    var i, a;
    for (i = dst.attributes.length - 1; i >= 0; i--) {
      a = dst.attributes[i];
      if (!src.hasAttribute(a.name)) dst.removeAttribute(a.name);
    }
    for (i = 0; i < src.attributes.length; i++) {
      a = src.attributes[i];
      if (dst.getAttribute(a.name) !== a.value) dst.setAttribute(a.name, a.value);
    }
  }

  /** Popup's own element that stays where it is in a copy (data-jr-keep: the Reply button), skipped by the patch. */
  function kept(n) { return n && n.nodeType === 1 && n.hasAttribute("data-jr-keep"); }
  function skipKept(n) { while (kept(n)) n = n.nextSibling; return n; }
  /** The first of Popup's own elements at the end (Reply): new nodes go before it, not after. */
  function tailKept(p) { var t = null; for (var n = p.lastChild; kept(n); n = n.previousSibling) t = n; return t; }

  /** An element the site draws into its own shadow root (Claude Code's code blocks: <diffs-container>): a copy has it
   *  only as an empty box (cloneNode leaves shadow roots out — live round 5: no code, no Copy in the popup). Its
   *  content and style sheets go into the copy's own root; changes in there are followed too. */
  function syncShadow(s, d) {
    var sr = s.shadowRoot;
    if (!sr) return;
    var dr = d.shadowRoot;
    if (!dr) { try { dr = d.attachShadow({ mode: "open" }); } catch (e) { return; } }
    var sheets = sr.adoptedStyleSheets || [];
    if (sheets.length && dr.adoptedStyleSheets.length !== sheets.length) {
      try { dr.adoptedStyleSheets = sheets; } catch (e) { // (another document's: the frame's) — rebuilt here
        dr.adoptedStyleSheets = sheets.map(function (x) {
          var c = new CSSStyleSheet();
          try { c.replaceSync(Array.prototype.map.call(x.cssRules, function (r) { return r.cssText; }).join("\n")); } catch (e2) { /* unreadable */ }
          return c;
        });
      }
    }
    if (live && live.observer && live.watched.indexOf(sr) === -1) {
      live.watched.push(sr);
      live.observer.observe(sr, { subtree: true, childList: true, characterData: true, attributes: true });
    }
    syncChildren(Array.prototype.slice.call(sr.childNodes), dr);
  }
  /** syncShadow for every element of a fresh clone, pairwise with its source. */
  function shadowsIn(s, d) {
    if (s.nodeType !== 1) return;
    syncShadow(s, d);
    for (var a = s.firstChild, b = d.firstChild; a && b; a = a.nextSibling, b = b.nextSibling) shadowsIn(a, b);
  }

  /** Make dstParent's children match srcNodes (an array), reusing matching nodes. */
  function syncChildren(srcNodes, dstParent) {
    var d = skipKept(dstParent.firstChild);
    for (var i = 0; i < srcNodes.length; i++) {
      var s = srcNodes[i];
      d = skipKept(d);
      if (d && sameKind(s, d)) {
        if (s.nodeType === 3 || s.nodeType === 8) {
          if (d.data !== s.data) d.data = s.data;
        } else if (s.nodeType === 1) {
          syncAttrs(s, d);
          syncChildren(Array.prototype.slice.call(s.childNodes), d);
          syncShadow(s, d);
        }
        d = d.nextSibling;
      } else {
        var c = s.cloneNode(true);
        dstParent.insertBefore(c, d || tailKept(dstParent)); // (live dev.145: Reply above the answer)
        shadowsIn(s, c);
      }
    }
    while (d) {
      var next = d.nextSibling;
      if (!kept(d)) dstParent.removeChild(d);
      d = next;
    }
  }

  /** Patch copyEl to match the original turn's answer (all its markdown roots: the sites scope their styling under
   *  the root's class and data-* attributes — R36b/h). False: the turn has no answer drawn yet. */
  function syncInto(copyEl, turn) {
    var bodies = JR.site.assistantBodies(turn);
    if (!bodies.length) return false;
    syncChildren(bodies, copyEl);
    if (JR.site.markCopy) Array.prototype.forEach.call(copyEl.children, JR.site.markCopy);
    return true;
  }

  var live = null; // { copyEl, keys, key, turn, observer, onChange, fromPage, tries, asked }

  function patch() {
    var l = live;
    if (!l) return;
    // the page dropped it (virtual list), the site redrew it, or a page copy stopped being good: find it again
    if (!l.turn.isConnected || (l.fromPage && !usable(l.turn))) return find(l);
    // the answer went on in a new row of its own (Claude Code: the reply after a tool step, same key): follow that one
    var later = l.fromPage && JR.site.findTurnByKey(l.key);
    if (later && later !== l.turn) return follow(l, later, l.key, true);
    // a frame original's generated styles apply only inside a marked copy — every copy it goes to (a rebuilt popup's too)
    if (l.turn.ownerDocument !== document) { if (JR.siteOriginalScope) JR.siteOriginalScope(l.copyEl); }
    else if (l.copyEl.hasAttribute("data-jr-frame")) { // now a page original: the frame's generated (ͼ) rules mean other things here
      l.copyEl.classList.remove("jr-frame-answer"); l.copyEl.removeAttribute("data-jr-frame");
    }
    if (syncInto(l.copyEl, l.turn) && l.onChange) l.onChange(l.copyEl, l.turn, l.key);
  }

  function follow(l, turn, key, fromPage) {
    if (live !== l) return;
    l.fromPage = fromPage;
    l.key = key;
    l.tries = 0; l.finding = false; // (found: a later loss gets its full rounds again)
    if (l.observer) l.observer.disconnect();
    l.turn = turn;
    l.watched = []; // shadow roots inside it also observed (syncShadow)
    l.observer = new MutationObserver(function () { if (live === l) patch(); }); // (it batches the changes already)
    l.observer.observe(turn, { subtree: true, childList: true, characterData: true, attributes: true });
    // the site replacing the whole turn (ChatGPT redraws one in the frame) changes nothing inside the old one
    if (turn.parentNode) l.observer.observe(turn.parentNode, { childList: true });
    patch();
  }

  /** A turn on the page is a good original — while it is streaming always (the only live one), after that only if
   *  the site draws it fully there: claude.ai colours code only on screen (a hidden row's stays black and white),
   *  ChatGPT draws charts / maps only on screen (blank in a copy) and sometimes shows "couldn't load" instead. */
  function usable(t) {
    if (!t) return false;
    if (JR.site.isGenerating() && newest(t)) return true; // (only the one streaming: the newest turn — review: an older
    // hidden row followed while anything streamed kept claude.ai's uncoloured code after it ended)
    if (JR.site.renderFailed && JR.site.renderFailed(t)) return false;
    if (JR.site.hasUndrawnWidget && JR.site.hasUndrawnWidget(t)) return false;
    return !JR.site.harvestable || JR.site.harvestable(t);
  }

  function newest(t) {
    var all = document.querySelectorAll(JR.SEL.turn);
    return all.length > 0 && all[all.length - 1] === t;
  }

  /** The original: the turn on the page, else the site's own place for it (JR.site.original: the render frame,
   *  DeepSeek's kept item), as long as it takes. */
  function find(l) {
    // the key followed till now first: asking for another one first would wait behind its own hold (review: ChatGPT's
    // legacy question + answer keys — the copy froze after a redraw in the frame)
    // (a local order: l.keys stays as the caller gave it, so its rebuilt popup is still the same Q&A — review)
    var keys = l.key ? [l.key].concat(l.keys.filter(function (k) { return k !== l.key; })) : l.keys;
    for (var i = 0; i < keys.length; i++) {
      var t = JR.site.findTurnByKey(keys[i]);
      // (only one with an answer drawn: ChatGPT's question is a turn of its own, also among the keys)
      if (usable(t) && JR.site.assistantBodies(t).length) return follow(l, t, keys[i], true);
    }
    // one search at a time: the site redrawing meanwhile asked again for each change (a test: without end)
    if (!JR.site.original || l.finding) return;
    l.finding = true;
    (function next(i) { // its keys in turn (2 in ChatGPT's legacy DOM: question and answer turn)
      if (live !== l) return;
      if (i >= keys.length) { // none yet: again a little later, then less often, as long as it is live (user: no backup —
        // "Loading…" meanwhile; review: after 3 rounds it stopped and the popup stayed on "Loading…" for good)
        l.finding = false;
        setTimeout(function () { if (live === l) find(l); }, ++l.tries < 3 ? 1000 : 3000);
        return;
      }
      var key = keys[i];
      l.asked.push(key);
      JR.site.original(key).then(function (turn) {
        // never a detached one (it would loop), and only one with an answer drawn
        if (!turn || !turn.isConnected || !JR.site.assistantBodies(turn).length) {
          if (turn && JR.site.releaseOriginal) JR.site.releaseOriginal(key);
          return next(i + 1);
        }
        if (live !== l) return JR.site.releaseOriginal && JR.site.releaseOriginal(key);
        follow(l, turn, key, false);
      });
    })(0);
  }

  /** Popup's own element in a copy (its highlight marks, Reply, gallery…): not in the original. */
  function own(n) {
    return typeof n.className === "string" && /(^|\s)jr-/.test(n.className);
  }
  /** n's place among its parent's elements, not counting Popup's own. */
  function place(n) {
    var i = 0;
    for (var p = n.previousElementSibling; p; p = p.previousElementSibling) if (!own(p)) i++;
    return i;
  }
  function siteChildren(n) {
    return Array.prototype.filter.call(n.children, function (c) { return !own(c); });
  }

  JR.siteAnswer = {
    /**
     * Keep copyEl (the active popup's answer area) in step with the original of the Q&A with these turn keys.
     * onChange(copyEl, turn, key) runs after every patch (Popup's own layer on the copy: its nested highlights).
     * Replaces the one live before.
     */
    follow: function (copyEl, keys, onChange) {
      keys = [].concat(keys || []).filter(Boolean);
      var l0 = live;
      if (l0 && l0.keys.join() === keys.join()) { // the same Q&A (its popup rebuilt — its question read back, say):
        l0.copyEl = copyEl; l0.onChange = onChange; // the original found (or being found) goes on, not found again (slow)
        return l0.turn ? patch() : undefined;
      }
      JR.siteAnswer.stop();
      var l = live = { copyEl: copyEl, keys: keys, key: null, turn: null, observer: null,
        onChange: onChange, fromPage: false, tries: 0, finding: false, asked: [] };
      find(l);
    },
    /**
     * The element of the live original at el's place in its copy (design B, user 2026-11-18): a click there is the
     * site's own — Run, Copy, word wrap, Download, a citation, whatever it adds later — and what it changes comes
     * back through the copy. Null when el isn't in the live copy or the original has nothing there.
     */
    counterpart: function (el) {
      var l = live;
      // (not one the site has replaced: a click there does nothing — live B6, ChatGPT redrew the frame's turn just after
      // it was found again; it is being found again now)
      if (!l || !l.turn || !l.turn.isConnected || el === l.copyEl) return null;
      // (across a shadow root: an element the site draws into its own — its host, then on inside the original's root)
      var path = [];
      for (var n = el; n && n !== l.copyEl; n = n.parentElement || (n.parentNode && n.parentNode.host)) {
        if (!own(n)) path.unshift(n);
      }
      if (!n) return null;
      var cur = null, list = JR.site.assistantBodies(l.turn);
      for (var i = 0; i < path.length; i++) {
        cur = list[place(path[i])];
        if (!cur || cur.tagName !== path[i].tagName) return null; // the copy is ahead of / behind the original
        var into = path[i + 1] && path[i + 1].getRootNode() !== path[i].getRootNode(); // the next is in its shadow root
        list = into ? (cur.shadowRoot ? Array.prototype.filter.call(cur.shadowRoot.children, function (c) { return !own(c); }) : []) : siteChildren(cur);
      }
      return cur;
    },
    /** For JR.diagnose: what the live copy follows and how its search stands. */
    state: function () {
      var l = live;
      return l && { keys: l.keys, key: l.key, turn: !!l.turn, connected: !!(l.turn && l.turn.isConnected),
        fromPage: l.fromPage, finding: l.finding, tries: l.tries, asked: l.asked.length };
    },
    /** The copy element live now, or null. */
    current: function () { return live ? live.copyEl : null; },
    /** Let the live original go (the popup closed, or another one is active). */
    stop: function () {
      var l = live;
      live = null;
      if (!l) return;
      if (l.observer) l.observer.disconnect();
      // every one asked for: one still being found is let go too (else the frame would keep it for good)
      if (JR.site.releaseOriginal) l.asked.forEach(JR.site.releaseOriginal);
    },
  };
})();

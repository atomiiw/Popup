// locator.js — Finds a version's original (GLOSSARY.md: locator): the page first, then the site's own place for it
// (the hidden copy of the chat on ChatGPT, claude.ai and Claude Code; the item DeepSeek keeps drawn), and says why
// when it can't — the one rule for "is this original good to copy" (docs/DESIGN-availability.md).
(function () {
  "use strict";

  /** The newest turn on the page (the only one that can be streaming). */
  function newest(t) {
    var all = document.querySelectorAll(JR.SEL.turn);
    return all.length > 0 && all[all.length - 1] === t;
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

  /** On the page now: { turn, key } of the first key (preferred first) with a usable answer drawn, or null. */
  function onPage(keys) {
    for (var i = 0; i < keys.length; i++) {
      var t = JR.site.findTurnByKey(keys[i]);
      // (only one with an answer drawn: ChatGPT's legacy question is a turn of its own, also among the keys)
      if (usable(t) && JR.site.assistantBodies(t).length) return { turn: t, key: keys[i] };
    }
    return null;
  }

  /**
   * In the site's own place, its keys in turn: { via, turn, key } or { why }. onWaiting(what) as it goes ("queue",
   * "frame", "older"); fresh: a new hidden copy first (Try again — the old one may be stuck).
   */
  function elsewhere(keys, onWaiting, fresh) {
    if (!JR.site.original) return Promise.resolve({ why: "no-place" });
    var via = JR.site.originalPlace || "frame", why = "not-found";
    return (function next(i) {
      if (i >= keys.length) return Promise.resolve({ why: why });
      var key = keys[i];
      return JR.site.original(key, onWaiting, fresh && i === 0).then(function (turn) {
        // never a detached one (it would loop), and only one with an answer drawn
        if (turn && turn.isConnected && JR.site.assistantBodies(turn).length) return { via: via, turn: turn, key: key };
        if (turn && JR.site.releaseOriginal) JR.site.releaseOriginal(key);
        why = (JR.site.originalWhy && JR.site.originalWhy(key)) || why;
        return next(i + 1);
      }, function () { return next(i + 1); });
    })(0);
  }

  JR.locator = { usable: usable, onPage: onPage, elsewhere: elsewhere };
})();

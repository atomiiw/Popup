// reach-turn.js — Scroll a chat's list until the turn with a key is mounted: the page's (∧ ∨, a highlight's turn) and the
// hidden copy's (an original) alike — one way (architecture review candidate 3, docs/DESIGN-availability.md). The
// sites mount only the turns near the scroll position; ChatGPT's new front end loads earlier turns a page at a time,
// on a scroll at the top.
(function () {
  "use strict";

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /**
   * list: { top(), setTop(v), height(), view(), mounted() → [{ key, top, height }] (in the list's content),
   *         find(key) → the turn or null, before() — called before each scroll (claude.ai: let go of the bottom) }.
   * order: the conversation's turn keys in order ([] when unknown). opts: { cancel() → true to stop, onWaiting(what),
   * position(key) → its place (default: in order; DeepSeek: its ids), wait(ms) (tests) }. Resolves { turn } or { why }: cancelled, not-in-order, not-loaded (earlier turns never came),
   * stuck (the list draws nothing where it is scrolled), not-found.
   */
  JR.reachTurn = function (list, key, order, opts) {
    opts = opts || {};
    var pause = opts.wait || wait, cancel = opts.cancel || function () { return false; };
    order = order || [];
    var pos = opts.position || function (k) { return order.indexOf(k); };
    var target = pos(key), noOrder = target < 0 && !order.length;
    var atTop = 0, topHeight = -1, blank = 0, lastH = list.height(), settling = 0;
    var below = 0, above = Infinity, height = -1; // scroll positions where it was seen to be further down / up
    // (no order: nothing to aim with — a screen a step, no gap left unseen)
    var stride = noOrder ? 1 : 0.8, lastDir = 0; // a step, in screens: halved each time the direction turns (it went to and fro past it)
    var from = list.top(), dir0 = -1; // no order: up from here (loading earlier turns), then down from here
    function scroll(v) { if (list.before) list.before(); list.setTop(Math.max(0, v)); }
    var here = list.find(key);
    if (here) return Promise.resolve({ turn: here }); // (mounted already — the copy opened at it: no scroll away from it)
    if (target >= 0 && order.length) scroll(list.height() * target / order.length - list.view() / 2);
    else if (!noOrder && target < 0) scroll(list.height()); // not in the order: newer than it (sent since) — at the end
    // (a place but no order — DeepSeek's ids: from where the reader is, not thrown to the end first — ponytail review)
    var steps = target < 0 && !noOrder ? 8 : noOrder ? 400 : 160;
    return (function step(n) {
      var t = list.find(key);
      if (t) return Promise.resolve({ turn: t });
      if (cancel()) return Promise.resolve({ why: "cancelled" });
      // the list changed a lot since the last look (live NT4 A2 / NT5, ChatGPT: scrolled near the end it collapses its
      // list, draws nothing where it was, and builds it again — a step meanwhile, on that list, set it rebuilding again,
      // step after step): looked at again once it holds still (~3 s at most), not stepped on
      var h = list.height(), moved = Math.abs(h - lastH) > 0.1 * Math.max(lastH, 1);
      lastH = h;
      if (moved && settling < 20) { settling++; return pause(150).then(function () { return step(n); }); }
      if (n <= 0) return Promise.resolve({ why: target < 0 && !noOrder ? "not-in-order" : "not-found" });
      var all = list.mounted(), top = list.top(), view = list.view();
      // the list draws nothing where it is scrolled to: being built — looked at again, not stepped on; that for ~1.2 s:
      // stuck (live 11-20, the hidden copy) — not a long turn filling the screen (its own turn is there)
      var drawn = all.some(function (m) { return m.top < top + view && m.top + m.height > top; });
      blank = drawn || !all.length ? 0 : blank + 1; // (turns mounted, none where it is: a list with none is no sign)
      if (blank >= 8) return Promise.resolve({ why: "stuck" });
      if (blank) return pause(150).then(function () { return step(n); });
      // (the turns around where it is: claude.ai keeps the last turn mounted wherever the list is — taken for one of the
      // turns here it said "past the target" and the search went up to the top: live NT1, couldn't be loaded)
      var at = all.filter(function (m) { return m.top < top + 3 * view && m.top + m.height > top - 2 * view; })
        .map(function (m) { return { i: pos(m.key), top: m.top }; })
        .filter(function (p) { return p.i >= 0; }).sort(function (a, b) { return a.i - b.i; });
      var last = at[at.length - 1];
      var down = noOrder ? dir0 > 0 : target >= 0 && at.length > 0 && last.i < target;
      if (!down && top <= 0) {
        // at the top, the turn earlier still: earlier turns come on a scroll there (at 0 already, setting 0 again is no
        // scroll — a step down and back is one); until none come for ~3 s
        if (list.height() > topHeight) { topHeight = list.height(); atTop = 0; }
        if (++atTop > 12) {
          if (noOrder && dir0 < 0) { dir0 = 1; scroll(from); return pause(150).then(function () { return step(n - 1); }); }
          return Promise.resolve({ why: "not-loaded" });
        }
        if (opts.onWaiting) opts.onWaiting("older");
        scroll(40);
        return pause(50).then(function () { scroll(0); return pause(200); }).then(function () { return step(n - 1); });
      }
      if (noOrder && down && top + view >= list.height() - 1) return Promise.resolve({ why: "not-found" });
      if (list.height() > height * 1.1) { height = list.height(); below = 0; above = Infinity; } // earlier turns came
      if (target >= 0 && at.length) { if (down) below = Math.max(below, top); else if (at[0].i > target) above = Math.min(above, top); }
      var dir = down ? 1 : -1;
      if (!noOrder && lastDir && dir !== lastDir) stride = Math.max(0.1, stride / 2);
      lastDir = dir;
      var want = top + dir * view * stride;
      var per = at.length >= 2 ? (last.top - at[0].top) / Math.max(1, last.i - at[0].i) : 0;
      if (target >= 0 && per > 0 && (target < at[0].i - 2 || target > last.i + 2)) {
        // far off: jump to where it should be, from the turns there and their average height (a fresh list has only the
        // last turns loaded, so the place estimated from the whole order was far off)
        var ref = target < at[0].i ? at[0] : last;
        want = ref.top + (target - ref.i) * per - view / 2;
        // …but never back past where it was seen to be below / above: halfway instead (turn heights differ a lot)
        var lim = Math.min(above, list.height());
        // …unless that window is under a screen and it isn't there: earlier than every turn loaded — to the top (earlier
        // turns come there); else the bounds are from before the heights were measured
        if (lim - below < view) {
          if (target < at[0].i) want = 0;
          else { below = 0; above = Infinity; lim = list.height(); }
        }
        if (want !== 0 && !(want > below && want < lim)) want = (below + lim) / 2;
      }
      scroll(want);
      return pause(150).then(function () { return step(n - 1); });
    })(steps);
  };

  /** The list adapter over a document's chat: its scroller and its turns (the page's, or the hidden copy's). */
  JR.reachTurn.listOf = function (scroller, turnsOf, find, before) {
    return {
      top: function () { return scroller.scrollTop; },
      setTop: function (v) { scroller.scrollTop = v; },
      height: function () { return scroller.scrollHeight; },
      view: function () { return scroller.clientHeight; },
      mounted: function () {
        var base = scroller.getBoundingClientRect().top - scroller.scrollTop;
        return turnsOf().map(function (t) {
          var r = t.getBoundingClientRect();
          return { key: JR.site.turnKey(t), top: r.top - base, height: r.height };
        });
      },
      find: find,
      before: before,
    };
  };
})();

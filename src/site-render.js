// site-render.js — The site draws a Popup answer itself (R34; ChatGPT and claude.ai — DeepSeek forbids framing).
//
// Popup's Q&A turns are hidden in the page (and filtered out of its data after a reload), so ChatGPT
// renders them only by chance (while it streams, near the bottom). For everything else Popup used to
// redraw the Markdown itself and chase ChatGPT's format changes. Instead: a hidden same-origin iframe
// of the same conversation (Popup doesn't run in frames, so there nothing is filtered or hidden),
// scrolled — invisibly — to the turn; ChatGPT renders it there and Popup copies the result.
// Nothing is stored: one frame per conversation, kept while requests come, dropped after 3 min idle.
(function () {
  "use strict";

  var frame = null, frameConv = null, idleTimer = null;
  var frameId = 0, styledId = 0; // each frame load gets an id: its generated CodeMirror class names belong to it
  var jobs = [], busy = false; // one at a time (they share the frame's scrolling), the newest first: the popup just
  // opened waits for at most the one in progress, not for every popup flipped past (live 2026-11-18: loading forever)

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /** Poll fn() every ms until it returns something truthy, or give up after tries. */
  function until(fn, ms, tries) {
    return new Promise(function (resolve) {
      (function poll(n) {
        var v; try { v = fn(); } catch (e) { v = null; }
        if (v || n <= 0) return resolve(v || null);
        setTimeout(function () { poll(n - 1); }, ms);
      })(tries);
    });
  }

  function dropFrame() {
    if (frame) frame.remove();
    frame = null; frameConv = null;
  }

  function frameFor(conv) {
    if (frame && frameConv === conv && frame.isConnected) return frame;
    dropFrame();
    frame = document.createElement("iframe");
    frame.className = "jr-render-frame"; // unseen, laid out at a popup's width (styles.css)
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.src = JR.site.chatUrl(conv);
    frame.addEventListener("load", function () { guardFocus(doc()); }); // the site focusing its composer in there
    frameConv = conv;
    frameId++;
    document.body.appendChild(frame);
    return frame;
  }

  function doc() {
    try { return frame && frame.contentDocument; } catch (e) { return null; }
  }

  /** The frame's mounted turns that are in the order, as { i: place in the order, top: in the scroller }, by place. */
  function placed(d, sc, order) {
    var base = sc.getBoundingClientRect().top - sc.scrollTop;
    return Array.prototype.map.call(d.querySelectorAll(JR.SEL.turn), function (t) {
      return { i: order.indexOf(JR.site.turnKey(t)), top: t.getBoundingClientRect().top - base };
    }).filter(function (p) { return p.i >= 0; }).sort(function (a, b) { return a.i - b.i; });
  }

  /**
   * The turn in the frame. ChatGPT mounts only turns near the scroll position and, in a long chat, loads the earlier
   * ones only when scrolled to the top (live 2026-11-18: the turn was never reached and the popup kept Popup's
   * drawing). With the conversation's turn order: jump to its estimated place, then step toward it; at the top, wait
   * for earlier turns to load. Without an order (it failed to load): from the bottom up.
   */
  function findTurn(key) {
    var d = doc(), sc = d && JR.site.frameScroller(d);
    if (!sc) return Promise.resolve(null);
    var order = JR.qa.turnOrderCache || [], target = order.indexOf(key), atTop = 0;
    var below = 0, above = Infinity, height = -1; // scroll positions where it was seen to be further down / up
    var stride = 0.8, lastDir = 0; // a step, in screens: halved each time the direction turns (it went to and fro past it)
    if (target >= 0) sc.scrollTop = sc.scrollHeight * target / order.length - sc.clientHeight / 2;
    else sc.scrollTop = sc.scrollHeight;
    // not in the order: newer than it (sent since) — at the end if anywhere; look there only (it was a 40 s search)
    var steps = target < 0 && order.length ? 8 : 160;
    return (function step(n) {
      var t = JR.site.frameTurn(d, key);
      if (!t && wanted !== key) return Promise.resolve(null); // let go: stop (it ran 40 s for nobody)
      if (t || n <= 0) return Promise.resolve(t || null);
      var at = placed(d, sc, order), last = at[at.length - 1];
      var down = target >= 0 && at.length && last.i < target;
      if (!down && sc.scrollTop <= 0) {
        if (++atTop > 20) return Promise.resolve(null); // ~5 s at the top and nothing earlier came
      } else atTop = 0;
      if (sc.scrollHeight > height * 1.1) { height = sc.scrollHeight; below = 0; above = Infinity; } // earlier turns came (not: measured heights settling)
      if (target >= 0 && at.length) { if (down) below = Math.max(below, sc.scrollTop); else if (at[0].i > target) above = Math.min(above, sc.scrollTop); }
      var dir = down ? 1 : -1;
      if (lastDir && dir !== lastDir) stride = Math.max(0.1, stride / 2);
      lastDir = dir;
      var want = sc.scrollTop + dir * sc.clientHeight * stride;
      var per = at.length >= 2 ? (last.top - at[0].top) / Math.max(1, last.i - at[0].i) : 0;
      if (target >= 0 && per > 0 && (target < at[0].i - 2 || target > last.i + 2)) {
        // far off: jump to where it should be, from the turns there and their average height (live 2026-11-18: a fresh
        // frame has only the last turns loaded, so the place estimated from the whole order was far off — 62 steps)
        var ref = target < at[0].i ? at[0] : last;
        want = ref.top + (target - ref.i) * per - sc.clientHeight / 2;
        // …but never back past where it was seen to be below / above: halfway instead (turn heights differ a lot, the
        // jumps went to and fro past it — 160 steps, 40 s)
        var top = Math.min(above, sc.scrollHeight);
        // …unless that window is under a screen and it isn't there: the bounds are from before the frame measured its
        // heights (live 2026-11-19: earlier turns, then later ones at the same place — 160 steps to and fro, 40 s)
        if (top - below < sc.clientHeight) { below = 0; above = Infinity; top = sc.scrollHeight; }
        if (!(want > below && want < top)) want = (below + top) / 2;
      }
      sc.scrollTop = Math.max(0, want);
      return wait(250).then(function () { return step(n - 1); });
    })(steps);
  }

  /** Scroll the frame to the top until the whole conversation is loaded (no growth for 2 s, or 30 s), so a later
   *  findTurn doesn't wait for earlier turns. */
  function loadAll() {
    var d = doc(), sc = d && JR.site.frameScroller(d);
    if (!sc) return Promise.resolve();
    var last = -1, same = 0;
    return (function step(n) {
      if (jobs.length) return Promise.resolve(); // a popup is waiting for an answer: it goes first (findTurn loads what it needs)
      sc.scrollTop = 0;
      if (sc.scrollHeight === last) same++; else { same = 0; last = sc.scrollHeight; }
      if (same >= 8 || n <= 0) return Promise.resolve();
      return wait(250).then(function () { return step(n - 1); });
    })(120);
  }

  /** Bring each code block of the turn into the frame's visible top part in turn (claude.ai colours code only when
   *  it is on screen; the frame is in the viewport, unseen, but a long answer's lower blocks were below it). */
  function revealCode(turn, key) {
    var blocks = Array.prototype.slice.call(turn.querySelectorAll("pre"));
    return blocks.reduce(function (p, pre) {
      return p.then(function () { if (wanted !== key) return null; pre.scrollIntoView({ block: "start" }); return wait(250); }); // (let go: stop)
    }, Promise.resolve());
  }

  /**
   * CSS text applying ruleTexts only inside answers taken from frame load `id` (CSS nesting: each rule
   * becomes a descendant of the scope). CodeMirror generates its class names (ͼ1, ͼ2…) per document at
   * run time, so the frame's rules can't be copied as they are: in the page the same names may mean
   * something else (R36g: copied code blocks lost their indentation and line height).
   */
  JR.scopeFrameRules = function (ruleTexts, id) {
    return ruleTexts.length ? '.jr-frame-answer[data-jr-frame="' + id + '"] {\n' + ruleTexts.join("\n") + "\n}" : "";
  };

  /** Bring the frame's generated (ͼ) rules into the page, scoped to this frame load's answers. Once per load. */
  function copyFrameStyles() {
    if (styledId === frameId) return;
    var d = doc();
    if (!d) return;
    var texts = [];
    [].slice.call(d.styleSheets).concat([].slice.call(d.adoptedStyleSheets || [])).forEach(function (ss) {
      var rules;
      try { rules = ss.cssRules; } catch (e) { return; } // cross-origin sheet
      [].forEach.call(rules, function (r) {
        if ((r.type === 1 || r.type === 4) && r.cssText.indexOf(".\u037C") !== -1) texts.push(r.cssText); // style / @media rules with ͼ classes
      });
    });
    // an earlier load's rules no copy uses any more go (one per frame load stayed for good)
    Array.prototype.forEach.call(document.querySelectorAll("style[data-jr-frame-styles]"), function (old) {
      if (!document.querySelector('[data-jr-frame="' + old.getAttribute("data-jr-frame-styles") + '"]')) old.remove();
    });
    var el = document.createElement("style");
    el.setAttribute("data-jr-frame-styles", String(frameId));
    el.textContent = JR.scopeFrameRules(texts, frameId);
    (document.head || document.documentElement).appendChild(el);
    styledId = frameId;
  }

  function frameReady() {
    return until(function () { var d = doc(); return d && JR.site.frameScroller(d) && JR.site.frameTurnCount(d); }, 300, 100);
  }

  /** Queue work; key / drop: the turn it finds, and what to do if that is let go before it runs (it isn't run). */
  function run(work, key, drop) {
    return new Promise(function (done) { jobs.push({ work: work, done: done, key: key, drop: drop }); next(); });
  }
  function next() {
    if (busy || !jobs.length) return;
    busy = true;
    clearTimeout(idleTimer); // not dropped while a job runs or holds its turn (a held original lasts as long as its popup)
    var job = jobs.pop();
    Promise.resolve().then(job.work).catch(function () { return null; }).then(function (r) {
      busy = false;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(dropFrame, 180000);
      job.done(r);
      next();
    });
  }

  /**
   * The original of the turn with this key in the frame (site-answer.js, design A): the frame's turn, held there —
   * the frame isn't scrolled for anything else — until JR.siteOriginalRelease(key). Null if it isn't found.
   */
  var holding = null, wanted = null, reloadedFor = new Set(); // { key, release }; the key asked for and not released yet;
  // the keys a fresh frame was loaded for once (a Set: two answers asked in turn would reload it for each again)
  JR.siteOriginal = function (key) {
    // held already: the site redrew it in the frame (live 2026-11-18: the re-ask then waited behind its own hold) — the
    // frame's turn now, at once
    if (holding && holding.key === key) { // (mid-redraw: a moment; gone for good — the frame scrolled on: found again)
      return until(function () { var d = doc(); return d && JR.site.frameTurn(d, key); }, 100, 10).then(function (t) {
        if (t) return t;
        JR.siteOriginalRelease(key);
        return JR.siteOriginal(key);
      });
    }
    wanted = key;
    return new Promise(function (give) {
      run(function () {
        var conv = JR.site.conversationId();
        if (!conv || !key) return give(null);
        frameFor(conv);
        return frameReady()
          .then(function (ready) { return ready && JR.qa.turnOrder ? JR.qa.turnOrder().then(function () { return ready; }) : ready; })
          .then(function (ready) { return ready ? findTurn(key) : null; })
          .then(function (turn) {
            // an answer newer than the frame (sent after it loaded): a fresh frame has it — once
            if (turn || wanted !== key || (JR.qa.turnOrderCache || []).indexOf(key) >= 0 || reloadedFor.has(key)) return turn;
            reloadedFor.add(key);
            // sent after the order and the frame were loaded: both again (review: else the search looks only at the end)
            JR.qa.resetApi();
            dropFrame(); frameFor(conv);
            run(loadAll); // (after this one: the next answer asked for is then found at once)
            return frameReady()
              .then(function (ready) { return ready && JR.qa.turnOrder ? JR.qa.turnOrder().then(function () { return ready; }) : ready; })
              .then(function (ready) { return ready ? findTurn(key) : null; });
          })
          .then(function (turn) { return turn && wanted === key ? revealCode(turn, key).then(function () { return turn; }) : turn; })
          .then(function (turn) {
            if (wanted !== key) turn = null; // released (the popup closed) while it was being found: don't hold it
            give(turn);
            if (!turn) return null;
            return new Promise(function (release) { holding = { key: key, release: release }; });
          })
          .catch(function () { give(null); }); // (a failure must end it: else its popup waits forever)
      }, key, give);
    });
  };
  JR.siteOriginalRelease = function (key) {
    if (wanted === key) wanted = null;
    jobs = jobs.filter(function (j) { if (j.key !== key) return true; j.drop(null); j.done(null); return false; }); // not found for nobody
    if (!holding || holding.key !== key) return;
    var h = holding;
    holding = null;
    h.release();
  };
  /** For JR.diagnose: the frame and its queue. */
  JR.siteRenderState = function () {
    return { frame: !!(frame && frame.isConnected), busy: busy, jobs: jobs.length, holding: holding && holding.key, wanted: wanted };
  };
  /** A copy of a frame original: scoped to this frame load's generated styles (JR.scopeFrameRules). */
  JR.siteOriginalScope = function (copyEl) {
    copyFrameStyles();
    if (!copyEl.classList.contains("jr-frame-answer")) copyEl.classList.add("jr-frame-answer");
    if (copyEl.getAttribute("data-jr-frame") !== String(frameId)) copyEl.setAttribute("data-jr-frame", String(frameId));
  };


  /** Load the frame ahead (after a reload, when this conversation has Popup answers) with the whole conversation,
   *  so opening one is quick. Queued like a render: they share the frame's scrolling. */
  JR.siteRenderPrewarm = function () {
    var conv = JR.site.conversationId();
    if (!conv) return;
    frameFor(conv);
    run(function () { return frameReady().then(function (ready) { return ready ? loadAll() : null; }); });
  };

  // Another conversation: this frame's answers are no use any more.
  window.addEventListener("popstate", dropFrame);

  // The frame never keeps the keyboard (live 2026-11-19: ChatGPT focuses its composer when the frame loads — after a
  // reload, after a send — and what the user typed next, Esc too, went into the unseen chat). Focus goes back where it
  // was; only a forwarded click gets the frame for a moment (the site's Copy writes the clipboard only from a focused
  // document: JR.siteOriginalFocus).
  var lastFocus = null, focusUntil = 0, guarded = new WeakSet();
  function guardFocus(fd) { // once per frame document
    if (!fd || guarded.has(fd)) return;
    guarded.add(fd);
    fd.addEventListener("focusin", function () { setTimeout(giveFocusBack, 0); }, true);
    // a key while a forwarded click has the frame is the page's (review: Esc right after Copy didn't close the popup)
    fd.addEventListener("keydown", function (e) {
      e.preventDefault(); e.stopPropagation();
      focusUntil = 0; giveFocusBack();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: e.key, code: e.code, bubbles: true, cancelable: true }));
    }, true);
  }
  document.addEventListener("focusin", function (e) { if (!frame || e.target !== frame) lastFocus = e.target; }, true);
  function giveFocusBack() {
    if (!frame || document.activeElement !== frame || Date.now() < focusUntil) return;
    if (lastFocus && lastFocus.isConnected && lastFocus !== document.body) lastFocus.focus({ preventScroll: true });
    if (document.activeElement === frame) frame.blur();
  }
  ["blur", "focus"].forEach(function (t) { window.addEventListener(t, function () { setTimeout(giveFocusBack, 0); }); });
  JR.siteOriginalFocus = function (ms) {
    guardFocus(doc());
    focusUntil = Date.now() + ms;
    setTimeout(giveFocusBack, ms + 10);
  };
  JR.siteOriginalGiveFocusBack = giveFocusBack; // (tests)
})();

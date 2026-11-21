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
    if (JR.siteControl) JR.siteControl.closeAll(); // (a site menu shown from it outlived it — audit)
    if (frame) frame.remove();
    frame = null; frameConv = null;
  }

  // at: the id of the question after the answer looked for — the copy opens at that answer (net-tap.js: its first page
  // ends there); null: at the end, as the chat is
  var frameAt = null;
  // At most 5 copies loaded in 2 minutes: each is a whole page of the site (ChatGPT: a dozen requests and the whole
  // conversation — live 11-20, opening old popups one after another got the account a temporary limit). Over it: none.
  // (ChatGPT only: the rate limit is ChatGPT's — review: claude.ai popups went unreachable after 5 chats)
  var boots = [];
  function canBoot() {
    boots = boots.filter(function (t) { return Date.now() - t < 120000; });
    return JR.site.name !== "chatgpt" || boots.length < 5;
  }
  function frameFor(conv, at) {
    if (frame && frameConv === conv && frame.isConnected && (at === undefined || frameAt === (at || null))) return frame;
    if (!canBoot()) return null;
    boots.push(Date.now());
    frameAt = at || null;
    dropFrame();
    frame = document.createElement("iframe");
    frame.className = "jr-render-frame"; // unseen, laid out at a popup's width (styles.css)
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.src = JR.site.chatUrl(conv) + (frameAt ? "#jr-before=" + frameAt : "");
    frame.addEventListener("load", function () { guardFocus(doc()); }); // the site focusing its composer in there
    frameConv = conv;
    frameId++;
    document.body.appendChild(frame);
    return frame;
  }

  function doc() {
    try { return frame && frame.contentDocument; } catch (e) { return null; }
  }


  /**
   * The turn in the frame. ChatGPT mounts only turns near the scroll position and, in a long chat, loads the earlier
   * ones only when scrolled to the top (live 2026-11-18: the turn was never reached and the popup kept Popup's
   * drawing). With the conversation's turn order: jump to its estimated place, then step toward it; at the top, wait
   * for earlier turns to load. Without an order (it failed to load): from the bottom up.
   */
  function findTurn(key, onWaiting, fresh) {
    var d = doc(), sc = d && JR.site.frameScroller(d);
    if (!sc) { missWhy[key] = "copy-not-ready"; return Promise.resolve(null); }
    var list = JR.reachTurn.listOf(sc, function () { return Array.prototype.slice.call(d.querySelectorAll(JR.SEL.turn)); },
      function (k) { return JR.site.frameTurn(d, k); });
    return JR.reachTurn(list, key, JR.qa.turnOrderCache || [], {
      cancel: function () { return !wanted.has(key); }, // let go: stop (it ran 40 s for nobody)
      onWaiting: onWaiting,
      wait: wait,
    }).then(function (r) {
      if (r.turn) return r.turn;
      // (not in the order of a fresh copy and a fresh read: on another branch than the one shown — looking again can't
      // help: Ask again — ponytail review)
      missWhy[key] = fresh && r.why === "not-in-order" ? "branch" : { stuck: "copy-stuck", "not-loaded": "not-loaded" }[r.why] || "not-found";
      return null;
    });
  }

  /** Scroll the frame to the top until the whole conversation is loaded (no growth for 2 s, or 30 s), so a later
   *  findTurn doesn't wait for earlier turns. */
  function loadAll() {
    var d = doc(), sc = d && JR.site.frameScroller(d);
    if (!sc) return Promise.resolve();
    var last = -1, same = 0;
    return (function step(n) {
      if (jobs.length) return Promise.resolve(); // a popup is waiting for an answer: it goes first (findTurn loads what it needs)
      if (sc.scrollTop <= 0) sc.scrollTop = 40; // (a scroll at the top each time, not none: see findTurn)
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
      return p.then(function () { if (!wanted.has(key)) return null; pre.scrollIntoView({ block: "start" }); return wait(250); }); // (let go: stop)
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
      idleTimer = setTimeout(function idle() { if (shown()) idleTimer = setTimeout(idle, 30000); else dropFrame(); }, 180000); // (not while its panel is shown)
      job.done(r);
      next();
    });
  }

  /**
   * The original of the turn with this key in the frame (site-answer.js, design A): the frame's turn, held there —
   * the frame isn't scrolled for anything else — until JR.site.releaseOriginal(key). Null if it isn't found.
   */
  // holding: { key, release }; wanted: the keys asked for and not released yet (a Set — one wanted key let a second ask
  // cancel the first: that popup stayed Loading… for good, architecture review 11-20); missWhy: why a key wasn't found
  var holding = null, wanted = new Set(), missWhy = {}, reloadedFor = new Set(), lastReread = 0;
  // the keys a fresh frame was loaded for once (a Set: two answers asked in turn would reload it for each again)
  JR.site.originalPlace = "frame";
  /** Why the last search for key found nothing: copy-not-ready, copy-stuck, not-loaded (earlier turns never came),
   *  not-found. */
  JR.site.originalWhy = function (key) { return missWhy[key] || "not-found"; };
  /** onWaiting(what): "queue" (behind another search), "frame" (looking in the hidden copy), "older" (loading earlier
   *  turns there). fresh: a new hidden copy first (Try again: the old one may be stuck). */
  JR.site.original = function (key, onWaiting, fresh) {
    // held already: the site redrew it in the frame (live 2026-11-18: the re-ask then waited behind its own hold) — the
    // frame's turn now, at once
    if (holding && holding.key === key) { // (mid-redraw: a moment; gone for good — the frame scrolled on: found again)
      return until(function () { var d = doc(); return d && JR.site.frameTurn(d, key); }, 100, 10).then(function (t) {
        if (t) return t;
        JR.site.releaseOriginal(key);
        return JR.site.original(key);
      });
    }
    wanted.add(key);
    if (onWaiting && busy) onWaiting("queue");
    return new Promise(function (give) {
      run(function () {
        var conv = JR.site.conversationId();
        if (!conv || !key) return give(null);
        if (fresh && canBoot()) { dropFrame(); reloadedFor.delete(key); }
        if (onWaiting) onWaiting("frame");
        // a Q&A newer than the order read (sent since): the order read again, and a copy newer than it (live Beta C2: the
        // copy and the order from before the send — looked for at the end of an old copy until the deadline)
        var known = (JR.qa.turnOrderCache || []).indexOf(key) >= 0;
        // (the whole conversation read again: at most every 30 s)
        if (!known && JR.site.name === "chatgpt" && JR.qa.resetApi && Date.now() - lastReread > 30000 && canBoot()) { lastReread = Date.now(); JR.qa.resetApi(); dropFrame(); }
        return (JR.qa.turnOrder ? JR.qa.turnOrder() : Promise.resolve([])).then(function (order) {
          // ChatGPT: the copy opened at the answer (its network tap there, net-tap.js) — the answer drawn last, at once;
          // no scrolling the copy to it (its list didn't follow a scroll: 20–40 s, or never — live 11-20). One already
          // drawn in the copy open now: that copy.
          var i = (order || []).indexOf(key), d0 = doc();
          var at = JR.site.name === "chatgpt" && i >= 0 && i < order.length - 1 ? order[i + 1] : null;
          if (at && !/^[0-9a-f-]{36}$/.test(at)) at = null; // (a ChatGPT message id, as net-tap.js reads it from the URL)
          if (!(frame && frameConv === conv && d0 && JR.site.frameTurn(d0, key)) && !frameFor(conv, at)) {
            missWhy[key] = "too-many"; // (over the copies' budget: none loaded — Try again in a minute)
            return false;
          }
          return frameReady().then(function (ready) {
            if (!ready || !at) return ready;
            return until(function () { var d = doc(); return d && JR.site.frameTurn(d, key); }, 200, 15).then(function () { return ready; });
          });
        })
          .then(function (ready) { if (!ready && missWhy[key] !== "too-many") missWhy[key] = "copy-not-ready"; return ready ? findTurn(key, onWaiting) : null; })
          .then(function (turn) {
            // not found: a fresh frame, once — the answer newer than the frame (sent after it loaded), or the frame's list
            // stuck (live 11-20, ChatGPT: after many sends it kept the same 3 turns mounted wherever it scrolled — an older
            // popup stayed Loading… for good)
            if (turn || !wanted.has(key) || reloadedFor.has(key)) return turn;
            if (!canBoot()) { missWhy[key] = "too-many"; return null; }
            reloadedFor.add(key);
            // sent after the order and the frame were loaded: both again (review: else the search looks only at the end)
            JR.qa.resetApi();
            dropFrame();
            frameFor(conv);
            run(loadAll); // (after this one: the next answer asked for is then found at once)
            return frameReady()
              .then(function (ready) { return ready && JR.qa.turnOrder ? JR.qa.turnOrder().then(function () { return ready; }) : ready; })
              .then(function (ready) { if (!ready && missWhy[key] !== "too-many") missWhy[key] = "copy-not-ready"; return ready ? findTurn(key, onWaiting, true) : null; });
          })
          .then(function (turn) { return turn && wanted.has(key) ? revealCode(turn, key).then(function () { return turn; }) : turn; })
          .then(function (turn) {
            if (!wanted.has(key)) turn = null; // released (the popup closed) while it was being found: don't hold it
            if (turn) reloadedFor.delete(key); // (found: a later stuck copy may be reloaded for it again — audit)
            give(turn);
            if (!turn) return null;
            return new Promise(function (release) { holding = { key: key, release: release }; });
          })
          .catch(function () { give(null); }); // (a failure must end it: else its popup waits forever)
      }, key, give);
    });
  };
  JR.site.releaseOriginal = function (key) {
    wanted.delete(key);
    jobs = jobs.filter(function (j) { if (j.key !== key) return true; j.drop(null); j.done(null); return false; }); // not found for nobody
    if (!holding || holding.key !== key) return;
    var h = holding;
    holding = null;
    h.release();
  };
  /** For JR.diagnose: the frame and its queue. */
  JR.siteRenderState = function () {
    return { frame: !!(frame && frame.isConnected), busy: busy, jobs: jobs.length, holding: holding && holding.key, wanted: Array.from(wanted) };
  };
  /**
   * A copy's look when its original is the hidden copy's drawing: the frame's generated (ͼ) rules, scoped to this frame
   * load (JR.scopeFrameRules) — all of it here (overnight plan A3: site-answer.js handled the marks too).
   * scope(copyEl, inFrame): marked for this load's rules (inFrame), or unmarked (a page original: the frame's rules mean
   * other things there). take(copyEl) → what to keep with a copy from memory (null: nothing); put(copyEl, taken): back.
   */
  JR.siteFrameStyles = {
    scope: function (copyEl, inFrame) {
      if (!inFrame) {
        if (copyEl.hasAttribute("data-jr-frame")) { copyEl.classList.remove("jr-frame-answer"); copyEl.removeAttribute("data-jr-frame"); }
        return;
      }
      copyFrameStyles();
      if (!copyEl.classList.contains("jr-frame-answer")) copyEl.classList.add("jr-frame-answer");
      if (copyEl.getAttribute("data-jr-frame") !== String(frameId)) copyEl.setAttribute("data-jr-frame", String(frameId));
    },
    take: function (copyEl) {
      var id = copyEl.getAttribute("data-jr-frame");
      if (!id) return null;
      var style = document.querySelector('style[data-jr-frame-styles="' + id + '"]');
      return { id: id, style: style && style.cloneNode(true) };
    },
    put: function (copyEl, taken) {
      if (!taken) return;
      copyEl.classList.add("jr-frame-answer");
      copyEl.setAttribute("data-jr-frame", taken.id);
      // (its load's rules may have gone with that load: back while a copy uses them — copyFrameStyles drops them after)
      if (taken.style && !document.querySelector('style[data-jr-frame-styles="' + taken.id + '"]')) document.head.appendChild(taken.style.cloneNode(true));
    },
  };


  /** Load the frame ahead (after a reload, when this conversation has Popup answers) with the whole conversation,
   *  so opening one is quick. Queued like a render: they share the frame's scrolling. */
  JR.siteRenderPrewarm = function () {
    var conv = JR.site.conversationId();
    if (!conv || !frameFor(conv)) return;
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
      if (JR.press.of(e).owner === "synthetic" || shown()) return; // (its panel shown on the page: the user's, keys and all — site-control.js dock) // (Esc sent to the site's menu there — site-control.js; else it came back as the page's: a loop)
      e.preventDefault(); e.stopPropagation();
      focusUntil = 0; giveFocusBack();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: e.key, code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey,
        shiftKey: e.shiftKey, altKey: e.altKey, repeat: e.repeat, bubbles: true, cancelable: true })); // (Cmd+C stays Cmd+C)
    }, true);
  }
  document.addEventListener("focusin", function (e) { if (!frame || e.target !== frame) lastFocus = e.target; }, true);
  function shown() { return frame && frame.classList.contains("jr-render-frame--shown"); }
  function giveFocusBack() {
    if (!frame || document.activeElement !== frame || Date.now() < focusUntil || shown()) return;
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

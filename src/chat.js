// chat.js — Chat injection, response capture, and scroll locking
(function () {
  "use strict";

  var st = JR.state;

  /**
   * Resolve the parent's current active item ID instead of inheriting the
   * stale parentItemId from ver1.  Falls back to memEntry.parentItemId.
   */
  function resolveParentItemId(memEntry, parentId) {
    if (parentId) {
      var parentEntry = st.completedHighlights.get(parentId);
      if (parentEntry && parentEntry.items && parentEntry.items.length > 0) {
        var pidx = parentEntry.activeItemIndex != null ? parentEntry.activeItemIndex : 0;
        if (parentEntry.items[pidx]) return parentEntry.items[pidx].id;
      }
    }
    return (memEntry && memEntry.parentItemId) || null;
  }

  // Block ChatGPT's stop button while a Popup question is generating.
  // Uses capture phase so it fires before ChatGPT's own handler.
  // st.allowStopClick lets Popup's own timeout stop generation (it used to be
  // swallowed by this very listener).
  document.addEventListener("click", function (e) {
    if (!st.responseWatchActive || st.allowStopClick) return;
    if (JR.site.isStopButton(e.target)) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);

  function stopGeneration() {
    var stopBtn = JR.site.stopButton();
    if (!stopBtn) return;
    st.allowStopClick = true;
    try { stopBtn.click(); } finally { st.allowStopClick = false; }
  }

  // Open Popup response streams (net-tap.js start/done), counted in JR.isGenerating.
  st.netActive = 0;
  document.addEventListener("jr-net", function (e) {
    var kind;
    try { kind = JSON.parse(e.detail).kind; } catch (err) { return; }
    if (kind === "start") st.netActive++;
    else if (kind === "done") st.netActive = Math.max(0, st.netActive - 1);
  });

  /** A file's name as ChatGPT may show it: the same, or with "(n)" / " (n)" before the extension. */
  function nameMatcher(fileName) {
    var m = /^(.*?)(\.[^.]*)?$/.exec(fileName);
    var esc = function (s) { return (s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); };
    // A whole word of the label ("Remove <name>", "<name>"): chart.png never matches piechart.png. ChatGPT's own suffix:
    // "image (2).png", and a pasted image.png named "image(20261120-164031).png" (new front end, live R1 11-20)
    return new RegExp("(?:^|\\s)(" + esc(m[1]) + "(?: ?\\([\\d-]+\\))?" + esc(m[2]) + ")(?=\\s|$)");
  }

  /**
   * The composer card of each file: { file → { name, remove } }, one card per file
   * (two files both called clipboard.png get two different cards). remove is the
   * card's × (the longest label holding the name: "Remove <name>").
   */
  function cardsFor(composer, files, before) {
    var old = new Set(before || []);
    // a button's label names its file ("Remove <name>"); DeepSeek's have none, its site layer gives one
    function label(b) { return (JR.site.buttonLabel ? JR.site.buttonLabel(b) : b.getAttribute("aria-label")) || ""; }
    var buttons = JR.site.composerButtons(composer).filter(function (b) { return !old.has(b); }), taken = {}, out = new Map();
    files.forEach(function (f) {
      var re = nameMatcher(f.name), name = null;
      buttons.forEach(function (b) {
        var m = re.exec(label(b));
        if (m && !name && !taken[m[1]]) name = m[1];
      });
      if (!name) return;
      taken[name] = true;
      var remove = buttons.filter(function (b) { return label(b).indexOf(name) !== -1; })
        .sort(function (a, b) { return label(b).length - label(a).length; })[0];
      out.set(f, { name: name, remove: remove });
    });
    return out;
  }

  // The composer's buttons just before Popup's paste: those cards are the user's own.
  var buttonsBeforePaste = [];

  /** Remove the cards of Popup's files from ChatGPT's composer (never the user's own). */
  function removeComposerAttachments(composer, files) {
    var cards = cardsFor(composer, files || [], buttonsBeforePaste);
    cards.forEach(function (c) { if (c.remove) c.remove.click(); });
  }

  // TODO 4e (files): the user's own files in the site's box are set aside for a Popup send and handed back after it.
  // Popup can hand back only files it holds: the ones the user put in the box (paste, drop, the site's file picker) —
  // kept in memory only, never stored.
  var userFiles = [], asideFiles = null;
  function noteUserFiles(list, e) {
    if (e._jrOwn || !list || !list.length) return; // (Popup's own paste into the box: attachToComposer)
    if (e.target && e.target.closest && e.target.closest(".jr-popup")) return; // a popup's own files
    Array.prototype.forEach.call(list, function (f) { userFiles.push(f); });
    if (userFiles.length > 10) userFiles = userFiles.slice(-10); // (held in memory: screenshots are MBs each)
  }
  document.addEventListener("paste", function (e) { noteUserFiles(e.clipboardData && e.clipboardData.files, e); }, true);
  document.addEventListener("drop", function (e) { noteUserFiles(e.dataTransfer && e.dataTransfer.files, e); }, true);
  document.addEventListener("change", function (e) { if (e.target && e.target.type === "file") noteUserFiles(e.target.files, e); }, true);

  /** Set every file in the site's box aside (true), or none when one isn't a file Popup holds (false: refused as before).
   *  checkOnly: only whether they could be (at the click; they leave the box at the real send: a queued send took them
   *  out early, and a file the user added meanwhile went out with it, hidden — audit 11-20). */
  JR.setAsideUserFiles = function (checkOnly) {
    var composer = JR.site.composer();
    if (!composer || !JR.site.composerCardCount) return false;
    var count = JR.site.composerCardCount(composer);
    if (!count) { userFiles = []; return true; } // (none in the box: the ones noted were taken out)
    var cards = cardsFor(composer, userFiles.slice().reverse(), []); // (the newest copy of a name first)
    if (cards.size !== count) return false;
    if (checkOnly) return true;
    // the box keeps its height while they're out: shorter, it gave the chat more room and the reader at the bottom
    // saw the chat move down ~196 px and back (live round 5, claude.ai)
    var box = attachBox(composer);
    if (box) { box.style.setProperty("--jr-hold-h", box.offsetHeight + "px"); box.setAttribute("data-jr-hold", ""); }
    var moved = [];
    cards.forEach(function (c, f) { c.remove.click(); moved.push(f); }); // (a card's name was read from its remove button)
    asideFiles = (asideFiles || []).concat(moved.reverse());
    return true;
  };
  /** Another chat opened: files set aside belong to the one left (never into this one's box). */
  JR.dropAsideFiles = function () { asideFiles = null; releaseHold(); };
  function releaseHold() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-jr-hold]"), function (b) { b.removeAttribute("data-jr-hold"); });
  }
  /** After a Popup send (done or not): the files set aside go back into the box (its height held until they're in). */
  function handBackFiles() {
    if (!asideFiles || !asideFiles.length) { releaseHold(); return; }
    var files = asideFiles;
    asideFiles = null;
    st.attaching = true; // (the next queued send waits: set aside mid-upload, the cards don't match yet)
    JR.attachToComposer(files, function () { st.attaching = false; releaseHold(); });
  }

  /** Show ChatGPT's composer again after Popup handed it files. */
  function endAttaching() {
    var box = attachBox(JR.site.composer());
    if (box) box.removeAttribute("data-jr-attaching");
  }
  // What hides while Popup hands the site files: the composer box, or the card around it that also holds the
  // file cards (DeepSeek, claude.ai)
  function attachBox(composer) { return (JR.site.attachBox || JR.site.composerBox)(composer); }

  /** Remove text (and Popup's attachment cards) from ChatGPT's composer (used when ChatGPT refused our send). */
  function clearComposer(composer, files) {
    if (!composer) return;
    removeComposerAttachments(composer, files);
    composer.focus({ preventScroll: true });
    try {
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
    } catch (e) { /* ignore */ }
    if (JR.site.composerText(composer).trim()) {
      composer.dispatchEvent(new InputEvent("beforeinput", { inputType: "deleteContentBackward", bubbles: true, cancelable: true }));
    }
    composer.blur();
  }

  // --- Turn snapshots & chat freeze ---

  /**
   * Record which turns exist right now, so the turn created by our send can be
   * recognised as "new". Keys, not counts: ChatGPT virtualizes the thread, so
   * the number of turns in the DOM changes as the user scrolls.
   */
  JR.snapshotTurns = function () {
    var turns = JR.site.turns();
    var keys = new Set();
    for (var i = 0; i < turns.length; i++) {
      var k = JR.site.turnKey(turns[i]);
      if (k) keys.add(k);
    }
    return { keys: keys, lastKey: turns.length ? JR.site.turnKey(turns[turns.length - 1]) : null };
  };

  /** True if turn comes after the snapshot's last turn (or that turn isn't mounted any more). */
  function isAfterSnapshot(turn, snap) {
    if (!snap.lastKey) return true;
    var last = JR.site.findTurnByKey(snap.lastKey);
    if (!last) return true;
    return !!(last.compareDocumentPosition(turn) & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  function norm60(s) {
    return (s || "").replace(/\s+/g, " ").trim().slice(0, 60);
  }

  /**
   * Turns created by a Popup send since the snapshot, in DOM order.
   *
   * "Not in the snapshot" alone is not enough: ChatGPT virtualizes the thread,
   * so scrolling remounts OLD turns that weren't in the DOM at snapshot time.
   * A turn only counts once its question text is rendered and identifies it:
   * equal to `message` when given, otherwise any Popup-format message. A turn
   * whose text isn't rendered yet shows nothing, so it can wait for the next check.
   */
  JR.findNewTurns = function (snap, message) {
    if (!snap || !snap.keys) return [];
    var want = message ? norm60(message) : null;
    var out = [];
    var turns = JR.site.turns();
    for (var i = 0; i < turns.length; i++) {
      var k = JR.site.turnKey(turns[i]);
      if (!k || snap.keys.has(k)) continue;
      if (!isAfterSnapshot(turns[i], snap)) continue;
      var ut = JR.site.userText(turns[i]);
      if (!ut || !ut.trim()) continue;
      if (want ? norm60(ut) !== want : !JR.isPopupMessage(ut)) continue;
      out.push(turns[i]);
    }
    return out;
  };

  // Freeze: while a Popup send is in flight, any turn that appears after the
  // snapshot is hidden synchronously inside a MutationObserver callback, which
  // runs before the browser paints — so the injected Q&A never flashes.
  var _freeze = null;

  JR.freezeChat = function () {
    if (_freeze) return;
    var snap = JR.snapshotTurns();
    var root = JR.site.scrollContainer() || document.body;
    var mo = new MutationObserver(function (records) {
      if (JR.perf) JR.perf.count("freezeObserver");
      // a site whose question row comes before the turn (claude.ai): hidden the moment it is added
      if (JR.site.freezeRow) records.forEach(function (r) {
        for (var n = 0; n < r.addedNodes.length; n++) if (r.addedNodes[n].nodeType === 1) JR.site.freezeRow(r.addedNodes[n]);
      });
      // only changes inside turns already hidden (the hidden answer streaming in): no new turn to look for (perf audit:
      // every streamed token scanned all the turns)
      if (!records.some(function (r) {
        var t = JR.site.turnOf(r.target), k = t && JR.site.turnKey(t);
        return !k || !(st.hiddenTurnKeys.has(k) || _freeze.keys.indexOf(k) !== -1);
      })) return;
      var fresh = JR.findNewTurns(snap);
      var keys = [];
      for (var i = 0; i < fresh.length; i++) {
        var k = JR.site.turnKey(fresh[i]);
        if (st.hiddenTurnKeys.has(k)) continue; // already hidden (an earlier Popup Q&A remounting)
        if (_freeze.keys.indexOf(k) === -1) { _freeze.keys.push(k); keys.push(k); }
      }
      if (keys.length) JR.hideTurnKeys(keys);
    });
    mo.observe(root, { childList: true, subtree: true });
    // A site whose new items have no key yet (DeepSeek) hides them by a selector until the send ends
    var sel = JR.site.freezeSelector && JR.site.freezeSelector(), style = null;
    if (sel) {
      style = document.createElement("style");
      style.id = "jr-freeze";
      style.textContent = sel + " { " + JR.site.hideDeclaration + " }";
      (document.head || document.documentElement).appendChild(style);
    }
    _freeze = { mo: mo, keys: [], style: style };
  };

  /** Stop freezing. Returns the keys the freeze hid (the caller unhides them if the send is abandoned). */
  JR.unfreezeChat = function () {
    if (!_freeze) return [];
    _freeze.mo.disconnect();
    if (_freeze.style) _freeze.style.remove();
    // the rows freezeRow hid: ours are hidden by key by now (its answer came); a failed send's shows again
    Array.prototype.forEach.call(document.querySelectorAll("[data-jr-freeze]"), function (r) { r.removeAttribute("data-jr-freeze"); });
    var keys = _freeze.keys;
    _freeze = null;
    return keys;
  };

  // --- Chat injection ---

  /** Text without any whitespace: a ProseMirror box's textContent has no line breaks between its paragraphs. */
  function bare(t) { return (t || "").replace(/\s+/g, ""); }

  /** Insert text into ChatGPT's composer. Returns true if the text is verifiably there. */
  function insertIntoComposer(composer, message) {
    var probe = bare(message).slice(0, 30);
    function landed() {
      return bare(JR.site.composerText(composer)).indexOf(probe) !== -1;
    }

    if (composer.tagName === "TEXTAREA") {
      var setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(composer, message);
      composer.dispatchEvent(new Event("input", { bubbles: true }));
      return landed();
    }

    // Strategy 1: ProseMirror beforeinput event (modern ProseMirror input handling)
    try {
      composer.dispatchEvent(new InputEvent("beforeinput", {
        inputType: "insertText", data: message, bubbles: true, cancelable: true, composed: true,
      }));
      if (landed()) return true;
    } catch (e) { /* ignore */ }

    // Strategy 2: execCommand insertText
    try {
      document.execCommand("insertText", false, message);
      if (landed()) return true;
    } catch (e) { /* ignore */ }

    // Strategy 3: synthetic paste event
    var dt = new DataTransfer();
    dt.setData("text/plain", message);
    var own = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    own._jrOwn = true; // not the user's files (TODO 4e)
    composer.dispatchEvent(own);
    return landed();
  }

  // The user's own half-typed message in the site's box (TODO 4e): set aside for a Popup send — only the question goes
  // — and put back once the site has cleared the box. "" when there is none.
  var lastDraft = "", lastHadAside = false; // lastHadAside: the last send had the user's files set aside
  // between Popup's text going into the box and the send button pressed: Popup's own text in the box is no refusal
  var submitting = false;
  // a tab in the background runs no animation frames (peer audit A2: a queued send there never pressed send; the
  // refusal check saw it in the box, cleared it, sent again — "Couldn't get a response")
  function nextFrame(cb) { return document.hidden ? setTimeout(cb, 16) : requestAnimationFrame(cb); }
  // The send's hold corrects now and after the site's queued updates — before the frame is drawn: what the site does
  // in reply to Popup typing or clicking runs right there, on ChatGPT ~0.4 s with no frame of ours (live 11-20)
  function holdNow() { if (JR.holdNow) { JR.holdNow(); Promise.resolve().then(function () { if (JR.holdNow) JR.holdNow(); }); } }
  function readDraft(composer) {
    var t = composer.tagName === "TEXTAREA" ? composer.value : composer.innerText || ""; // (innerText: its line breaks)
    return t.trim() ? t.replace(/\n+$/, "") : "";
  }
  function putDraftBack(composer, draft) {
    if (!composer || !draft || bare(JR.site.composerText(composer)) === bare(draft)) return;
    if (bare(JR.site.composerText(composer))) clearComposer(composer, []);
    composer.focus({ preventScroll: true });
    insertIntoComposer(composer, draft);
    composer.blur();
  }

  /** Record the outcome of a send step (shown by JR.diagnose and the timeout UI). */
  function report(ok, stage, detail) {
    st.lastSendReport = { ok: ok, stage: stage, detail: detail || null, when: new Date().toISOString() };
    if (!ok) {
      console.error("[Popup] Send failed at " + stage + (detail ? ": " + detail : ""));
      JR.diagnose();
    }
    return st.lastSendReport;
  }

  /**
   * Type `message` into ChatGPT's composer (hidden from view) and send it.
   * onDone(report) gets { ok, stage, detail } once the message is sent, or as
   * soon as a step fails (composer missing, text didn't land, couldn't submit).
   */
  JR.injectAndSend = function (message, onDone) {
    onDone = onDone || function () {};
    var chatInput = JR.site.composer();
    if (!chatInput) {
      onDone(report(false, "composer", JR.site.label + "'s input box was not found"));
      return;
    }

    // Prevent any ChatGPT-triggered scroll-to-bottom from causing a visible flicker.
    var scrollParent = JR.site.scrollContainer();
    var savedScrollTop = scrollParent ? scrollParent.scrollTop : 0;

    // Hide injected text + freeze composer height while it sits in the input.
    var composerH = chatInput.parentElement ? chatInput.parentElement.offsetHeight : 52;
    chatInput.setAttribute("data-jr-injecting", "");
    var hideStyle = document.createElement("style");
    hideStyle.id = "jr-hide-style";
    hideStyle.textContent =
      "[data-jr-injecting], [data-jr-injecting] * { color: transparent !important; caret-color: transparent !important; }" +
      // (min too: the draft set aside, a box of several lines got shorter and the chat moved — live round 5, claude.ai)
      "\n:has(> [data-jr-injecting]) { max-height: " + composerH + "px !important; min-height: " + composerH + "px !important; overflow: hidden !important; }";
    document.head.appendChild(hideStyle);
    function unhideComposer() {
      hideStyle.remove();
      chatInput.removeAttribute("data-jr-injecting");
    }

    chatInput.focus({ preventScroll: true });
    var draft = lastDraft = readDraft(chatInput);
    lastHadAside = !!(asideFiles && asideFiles.length);
    if (draft) clearComposer(chatInput, []), chatInput.focus({ preventScroll: true });
    if (draft && bare(JR.site.composerText(chatInput))) { // never sent along with the question
      putDraftBack(chatInput, draft);
      unhideComposer();
      handBackFiles();
      onDone(report(false, "draft", "the text already in the input box could not be set aside"));
      return;
    }
    var inserted = insertIntoComposer(chatInput, message);
    if (scrollParent) scrollParent.scrollTop = savedScrollTop;
    holdNow(); // (the site re-lays as its box changes — live 11-20: here, not at the click, the popup moved 52 px)
    submitting = inserted;
    if (!inserted) {
      putDraftBack(chatInput, draft);
      unhideComposer();
      handBackFiles();
      onDone(report(false, "insert", "the text did not appear in " + JR.site.label + "'s input box"));
      return;
    }

    var probe = bare(message).slice(0, 30);
    function afterSubmit(how) {
      submitting = false;
      chatInput.blur();
      if (scrollParent) scrollParent.scrollTop = savedScrollTop;
      // Keep the text hidden until React has actually cleared the input.
      var tries = 0;
      (function removeHideWhenEmpty() {
        var left = JR.site.composerText(chatInput);
        if (left.trim().length === 0 || tries > 20) {
          var stuck = bare(left).indexOf(probe) !== -1;
          if (stuck && !draft) clearComposer(chatInput, []); // (Popup's message never stays in the site's box — peer audit #13)
          putDraftBack(chatInput, draft); // (still hidden: it comes back as it was; stuck: in place of Popup's text)
          unhideComposer();
          handBackFiles();
          onDone(stuck ? report(false, "submit", "the message stayed in the input after " + how)
                       : report(true, "sent", how));
          return;
        }
        tries++;
        nextFrame(removeHideWhenEmpty);
      })();
    }

    var attempts = 0;
    function trySend() {
      var sendBtn = JR.site.sendButton(chatInput);
      if (sendBtn && !sendBtn.disabled) {
        if (scrollParent) scrollParent.scrollTop = savedScrollTop;
        sendBtn.click();
        // the site's send runs in this click — on ChatGPT ~0.4 s, its list re-laid, before any frame of ours: the hold
        // corrects now and after the site's queued updates, before that frame is drawn (live 11-20: 52 px off ~0.4 s)
        holdNow();
        afterSubmit("send button");
        return;
      }
      attempts++;
      if (attempts < 12) {
        setTimeout(trySend, 150);
        return;
      }
      // No usable send button (renamed / localized): try Enter, then form submit.
      chatInput.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true,
      }));
      setTimeout(function () {
        if (JR.site.composerText(chatInput).trim().length === 0) { afterSubmit("Enter key"); return; }
        var form = chatInput.closest("form");
        if (form && form.requestSubmit) {
          try { form.requestSubmit(); } catch (e) { /* ignore */ }
        }
        setTimeout(function () { afterSubmit("form submit"); }, 300);
      }, 300);
    }
    nextFrame(trySend);
  };

  /**
   * What the user is looking at, which must stay in place while ChatGPT re-lays its list after a send (R33):
   * the root highlight of the open popups (popups don't move with ChatGPT's list; a Reply or a stored
   * span may have no live element), else the first chat turn on screen. The ONE place that decides it.
   */
  JR.viewAnchor = function () {
    var root = st.popupStack.length ? st.popupStack[0].sourceHighlights : st.activeSourceHighlights;
    var hl = root && root[0];
    if (hl && hl.isConnected && !hl.closest(".jr-popup")) return hl;
    var band = JR.site.visibleBand();
    return JR.site.turns().filter(function (t) { var r = t.getBoundingClientRect(); return r.height && r.bottom > band.top; })[0] || null;
  };

  /**
   * Every send goes through here (called by the queue, never by a send path): snapshot the turns
   * (to spot the new one) and keep what the user is looking at in place while ChatGPT answers.
   */
  JR.prepareSend = function (w) {
    // Freeze here, when the message is really sent (not when it was queued).
    JR.freezeChat();
    w.turnsBefore = JR.snapshotTurns();
    w.unlockScroll = holdView();
    JR.setTailHidden(true);
  };

  /** Keep what the user is looking at in place until the returned function is called. */
  function holdView() {
    var scroller = JR.site.scrollContainer();
    var unlock = scroller ? JR.lockScroll(scroller, JR.viewAnchor()) : null;
    // Page-world guard (scroll-guard.js): the site's own scroll-to-new-turn is ignored while set.
    var html = document.documentElement;
    html.setAttribute("data-jr-scroll-lock", String(Date.now()));
    // it lapses after 2 min (a lost unlock); an answer can take longer (thinking): renewed while its watch runs — the
    // watch ends on its own (IDLE / GENERATING limits) — else the site scrolled again while lockScroll still held the view
    var renew = setInterval(function () {
      if (st.responseWatchActive && html.hasAttribute("data-jr-scroll-lock")) html.setAttribute("data-jr-scroll-lock", String(Date.now()));
    }, 30000);
    return function () {
      clearInterval(renew);
      // claude.ai keeps following its newest message after a send (pinned to the bottom): let go first, or its next
      // change scrolls the reader there once the guard is off (live 2026-11-19, Claude Code: to the end of the chat)
      if (JR.site.unpin) JR.site.unpin();
      document.documentElement.removeAttribute("data-jr-scroll-lock");
      if (unlock) unlock();
    };
  }

  // --- Message queue ---
  // When ChatGPT is generating, new popup sends are queued and dispatched
  // one-by-one as each generation completes.

  /**
   * Enqueue a message to be sent. If idle, sends immediately.
   * @param {object} opts
   * @param {string} opts.message - The injection message
   * @param {object} opts.waitOpts - Args for JR.waitForResponse (popup, text, sentence, blockTypes, parentId, question, editOpts, ...)
   */
  /**
   * Put files into ChatGPT's composer the way a user's paste does (ChatGPT uploads
   * them itself, with the user's account) and wait until the upload is done.
   * done({ sent: File[], failed: [{ file, reason }] }): a file ChatGPT did not take
   * fails; after 60 s without the upload finishing all cards are removed and every
   * file fails. The composer box is hidden meanwhile, so the cards never flash.
   */
  JR.attachToComposer = function (files, done) {
    var composer = JR.site.composer();
    if (!composer) {
      done({ sent: [], failed: files.map(function (f) { return { file: f, reason: JR.site.label + "'s input box was not found" }; }) });
      return;
    }
    var box = attachBox(composer);
    if (box) box.setAttribute("data-jr-attaching", "");
    // ChatGPT keeps only the last of several same-named files in one paste (T8: two
    // clipboard.png became one): hand it copies with distinct names, report the originals.
    var original = new Map(), used = {};
    var upload = files.map(function (f) {
      var name = f.name, m = /^(.*?)(\.[^.]*)?$/.exec(f.name), n = 1;
      while (used[name]) name = m[1] + " (" + (++n) + ")" + (m[2] || "");
      used[name] = true;
      var copy = name === f.name ? f : new File([f], name, { type: f.type, lastModified: f.lastModified });
      original.set(copy, f);
      return copy;
    });
    var dt = new DataTransfer();
    upload.forEach(function (f) { dt.items.add(f); });
    buttonsBeforePaste = JR.site.composerButtons(composer);
    var own = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    own._jrOwn = true; // not the user's files (TODO 4e)
    composer.dispatchEvent(own);
    var t0 = Date.now(), readySince = 0;
    (function check() {
      var elapsed = Date.now() - t0;
      var cards = cardsFor(composer, upload, buttonsBeforePaste);
      var carded = upload.filter(function (f) { return cards.has(f); });
      var btn = JR.site.sendButton(composer);
      var idle = btn && !btn.disabled && !JR.site.attachmentsUploading(composer);
      // A file ChatGPT refuses never gets a card (or loses it): after 5 s the others go without it.
      var looksReady = carded.length > 0 && idle && (carded.length === upload.length || elapsed > 5000);
      // ...and only once that has held for a moment (a refused card can show up briefly)
      readySince = looksReady ? (readySince || Date.now()) : 0;
      var ready = looksReady && Date.now() - readySince >= 1500;
      var nothingCame = carded.length === 0 && elapsed > 5000;
      if (!ready && !nothingCame && (elapsed < 60000 || readySince)) { setTimeout(check, 250); return; }
      var sentCopies = ready ? carded : [];
      var failedCopies = upload.filter(function (f) { return sentCopies.indexOf(f) === -1; });
      removeComposerAttachments(composer, failedCopies);
      done({
        sent: sentCopies.map(function (f) { return original.get(f); }),
        failed: failedCopies.map(function (f) {
          return { file: original.get(f), reason: !ready && carded.length ? "upload timed out" : JR.site.label + " did not accept it" };
        }),
      });
    })();
  };

  /** A send for this highlight still waits (queued, or its files going in): not failed, it hasn't gone yet. */
  JR.isQueued = function (hlId) {
    return st.attaching || st.messageQueue.some(function (o) {
      var w = o.waitOpts || {};
      return (w.editOpts ? w.editOpts.hlId : w.preRegisteredHlId) === hlId;
    });
  };

  JR.enqueueMessage = function (opts) {
    opts.url = location.href; // (sent only in the chat it was asked in — peer audit A8)
    if (JR.isGenerating() || st.responseWatchActive || st.attaching) {
      st.messageQueue.push(opts);
      return;
    }
    sendQueued(opts);
  };

  function sendQueued(opts) {
    // its highlight deleted while it waited (peer audit A1): not sent
    var qw = opts.waitOpts || {}, qid = qw.editOpts ? qw.editOpts.hlId : qw.preRegisteredHlId;
    if (qid && !st.completedHighlights.has(qid)) { JR.drainQueue(); return; }
    // another chat opened while it waited (the URL check runs every 500 ms, the queue every 300): never sent there
    // (the conversation, not the URL: claude.ai's Settings change the hash)
    if (opts.url && JR_HOST.convKey(opts.url) !== JR_HOST.convKey(location.href)) { st.messageQueue.length = 0; return; }
    // the user's own files leave the box now, at the real send (TODO 4e): handed back after it, done or not
    if (!opts.attached && !opts.aside && JR.site.composerHasAttachments(JR.site.composer())) {
      if (!JR.setAsideUserFiles()) {
        JR.prepareSend(opts.waitOpts);
        report(false, "files", "the user's own files in " + JR.site.label + "'s box can't be set aside");
        immediateTimeout(opts.waitOpts);
        JR.drainQueue();
        return;
      }
      // the site takes a moment to drop them: the send waits until their cards are gone (its send button may wait too)
      opts.aside = true;
      st.attaching = true;
      var t0 = Date.now(), from = location.href;
      (function gone() {
        if (JR.site.composerHasAttachments(JR.site.composer()) && Date.now() - t0 < 3000) { setTimeout(gone, 50); return; }
        setTimeout(function () {
          st.attaching = false;
          if (location.href === from) sendQueued(opts); // (another chat opened meanwhile: never sent there)
        }, 150);
      })();
      return;
    }
    // Files first: the answer watch's timers (refusal check, quick timeout) start
    // only when the message is really sent, not while ChatGPT uploads.
    if (opts.files && opts.files.length && !opts.attached) {
      st.attaching = true;
      var startUrl = location.href;
      // ChatGPT scrolls to the bottom when its box gets files (live: 208 px for ~2 s): hold the view from here on;
      // prepareSend takes over right after (same task)
      var release = holdView();
      JR.attachToComposer(opts.files, function (res) {
        release();
        st.attaching = false;
        if (location.href !== startUrl) { // the user opened another chat meanwhile: never send there
          removeComposerAttachments(JR.site.composer(), res.sent);
          endAttaching();
          JR.dropAsideFiles();
          return;
        }
        opts.attached = res;
        if (opts.onAttached) opts.onAttached(res);
        sendQueued(opts);
      });
      return;
    }
    var w = opts.waitOpts;
    JR.prepareSend(w);

    // Offline check: skip injection entirely, save "failed" at once
    if (!navigator.onLine) {
      if (opts.attached) { removeComposerAttachments(JR.site.composer(), opts.attached.sent); endAttaching(); }
      handBackFiles();
      report(false, "offline", "the browser is offline");
      immediateTimeout(w);
      JR.drainQueue();
      return;
    }

    var sentFiles = opts.attached ? opts.attached.sent : [];
    var watch = JR.waitForResponse(w.popup, w.turnsBefore, w.text, w.sentence, w.blockTypes, w.unlockScroll,
      w.parentId, w.question, w.editOpts, w.preRegisteredHlId, w.preRegisteredItemId, opts.message,
      w.wholeResponse, w.wholeResponseFull, sentFiles);
    JR.injectAndSend(opts.message, function (r) {
      endAttaching();
      if (!r.ok && watch) watch.failInjection(r);
    });
  }

  /**
   * Mark "failed" at once for a message that was never sent (e.g. offline).
   * Mirrors saveTimeoutVersion logic but without needing a waitForResponse context.
   */
  function immediateTimeout(w) {
    JR.unfreezeChat();
    if (w.unlockScroll) w.unlockScroll();
    var hlId = w.editOpts ? w.editOpts.hlId : (w.preRegisteredHlId || null);
    if (!hlId) return;
    var memEntry = st.completedHighlights.get(hlId);
    if (!memEntry) return;

    if (w.editOpts) {
      var newItemId = crypto.randomUUID();
      memEntry.items.push({ id: newItemId, question: w.question, status: "failed", turnKeys: [],
        _files: memEntry._editFiles, _failedFiles: memEntry._editFailed, attachments: (memEntry._editFiles || []).length });
      memEntry.activeItemIndex = memEntry.items.length - 1;
      memEntry.question = w.question;
      saveHighlight({
        id: newItemId, quoteId: hlId, text: memEntry.text, status: "failed",
        url: location.href, parentId: memEntry.parentId || null, parentItemId: memEntry.parentItemId || null,
        sourceTurnKey: memEntry.sourceTurnKey || null, turnKeys: [], active: true,
        wholeResponse: !!memEntry.wholeResponse, attachments: (memEntry._editFiles || []).length,
      });
    } else {
      var itemIdx = memEntry.activeItemIndex || 0;
      if (memEntry.items && memEntry.items[itemIdx]) {
        memEntry.items[itemIdx].status = "failed";
      }
      var updateId = w.preRegisteredItemId || (memEntry.items && memEntry.items[itemIdx] ? memEntry.items[itemIdx].id : null);
      if (updateId) {
        updateHighlightFields(updateId, { status: "failed" });
      }
    }

    // Rebuild popup
    var targetPopup = w.popup;
    if (targetPopup && targetPopup.isConnected) {
      JR.rebuildPopupAfterEdit(targetPopup, hlId);
    }
    JR.updateNavWidget();
  }

  /**
   * Drain the next queued message after a generation completes.
   * If ChatGPT is still generating, the poller below drains once it is idle.
   */
  JR.drainQueue = function () {
    if (st.messageQueue.length === 0) return;
    if (JR.isGenerating() || st.attaching) return; // one send at a time, uploads included
    var next = st.messageQueue.shift();
    sendQueued(next);
  };

  // Fallback poller: if messages are queued but no responseWatch is active
  // (e.g. user sent a question via ChatGPT's own input), poll until idle
  // then drain.
  setInterval(function () {
    if (st.messageQueue.length === 0) return;
    if (st.responseWatchActive || st.attaching) return;
    if (JR.isGenerating()) return;
    JR.drainQueue();
  }, 300);

  // --- Response capture ---

  // --- Incremental streaming mirror ---
  // Copying the whole answer every frame recreated every word, which restarted
  // ChatGPT's per-word fade-in and made text appear in jumps. Instead, patch the
  // popup copy in place: existing nodes are kept (text updated, attributes
  // synced) and only new nodes are cloned in, so each new word animates once.

  // (the patching itself: site-answer.js, shared with every other path — design A)

  /**
   * Keep the user's place while ChatGPT answers: every frame, undo any drift
   * of the anchor (ChatGPT's own scroll calls are blocked by scroll-guard.js).
   * Returns an unlock function.
   */
  /**
   * Where each open popup is to the reader's anchor now — at Return, before the popup grows (its question goes up,
   * Loading shows) — for the hold of the send to start from (live 11-20, ChatGPT: the popup grew 50 px inside the
   * list, ChatGPT re-laid it and the popup's place moved 52 px; the hold, starting a moment later, kept it there ~0.4 s).
   */
  JR.noteGluePlaces = function () {
    var a = JR.viewAnchor(), k = a ? JR.getTurnKey(a) : null;
    a = (k && JR.site.findTurnByKey(k)) || a;
    if (!a) return;
    var ay = a.getBoundingClientRect().top;
    st.popupStack.map(function (e) { return e.popup; }).concat(st.activePopup ? [st.activePopup] : []).forEach(function (p) {
      if (p && p.isConnected) p._jrGlueAt = { t: Date.now(), off: p.getBoundingClientRect().top - ay };
    });
  };

  JR.lockScroll = function (container, anchorEl) {
    // Anchor on the anchor's turn (by key): ChatGPT rebuilds turn DOM while the
    // virtual list re-measures, which detaches the original element.
    var anchorKey = anchorEl ? JR.getTurnKey(anchorEl) : null;
    if (anchorKey) anchorEl = JR.site.findTurnByKey(anchorKey) || anchorEl;
    // marked for scroll-guard.js (page world): a site scroll keeping it in view goes through
    var marked = null;
    function mark(el) {
      if (el !== marked) {
        if (marked) { marked.removeAttribute("data-jr-anchor"); marked.removeAttribute("data-jr-anchor-y"); }
        marked = el;
        if (el) el.setAttribute("data-jr-anchor", "");
      }
      // where the reader sees it: a site scroll that keeps it there goes through (scroll-guard.js)
      var y = savedAnchorY === null ? null : String(Math.round(savedAnchorY));
      if (el && el.getAttribute("data-jr-anchor-y") !== y) {
        if (y === null) el.removeAttribute("data-jr-anchor-y"); else el.setAttribute("data-jr-anchor-y", y);
      }
    }
    function liveAnchor() {
      if (!(anchorEl && anchorEl.isConnected) && anchorKey) anchorEl = JR.site.findTurnByKey(anchorKey);
      var a = anchorEl && anchorEl.isConnected ? anchorEl : null;
      mark(a);
      return a;
    }
    // a site scroll scroll-guard.js let through (it kept the reader's place): the place to fall back to from now on
    var html = document.documentElement, siteScroll = html.getAttribute("data-jr-site-scroll");
    // The open popups go with the anchor (live 2026-11-20, ChatGPT's new front end: the turns above it were laid out
    // anew, the hold kept the anchor in place by scrolling, so the list — and the popups placed in it — moved on screen:
    // a popup stood 464 px off its highlight for ~5 s, until its highlight was wrapped again). They keep where they were
    // to the anchor; placed again by anyone else (its highlight back): from there. An "above" popup by its bottom.
    // Measured on screen, not in the popup's parent: ChatGPT's new front end re-lays and moves the list a popup sits
    // in during a send (live 2026-11-20 05:00, Chrome Beta: the anchor held still, the popup moved +2490 then −2490 px
    // with its list and was off screen ~4 s; a placement by someone else in that list was taken as the new place).
    // Only the user (a drag of its edge, scrolling) gives it a new place. A "below" popup keeps its top, an "above" its bottom.
    var glued = new Map();
    function glue(anchor) {
      var pops = st.popupStack.map(function (e) { return e.popup; });
      if (st.activePopup) pops.push(st.activePopup);
      var ay = anchor.getBoundingClientRect().top, resizing = document.documentElement.classList.contains("jr-resizing");
      pops.forEach(function (p) {
        if (!p || !p.isConnected || !p.parentElement) return;
        var r = p.getBoundingClientRect();
        if (!r.height) return; // (not drawn: being measured)
        var above = p._jrLockedDirection === "above" && p._jrBottomAnchor != null, top = parseFloat(p.style.top) || 0;
        // an "above" one by the bottom it is placed to, not as drawn (live: measured the moment Return made it taller,
        // before its top followed, it was held 50 px low, over its highlight, for the whole send)
        var off = (above ? r.top - top + p._jrBottomAnchor : r.top) - ay;
        var g = glued.get(p);
        // its place at Return (JR.noteGluePlaces), if just taken: not one the popup's own growth since moved
        if (!g && !above && !resizing && !userScrolling && p._jrGlueAt && Date.now() - p._jrGlueAt.t < 2000) {
          g = { off: p._jrGlueAt.off };
          glued.set(p, g);
          JR.posLog("glue-base", p, { at: "return", off: Math.round(g.off), now: Math.round(off) });
        }
        p._jrGlueAt = null;
        // (the user scrolling — the chat or inside a parent popup, where a nested one follows its highlight — or
        // dragging an edge places it: taken as it is)
        if (!g || resizing || userScrolling) {
          if (!g || Math.abs(off - g.off) >= 0.5) JR.posLog("glue-base", p, { at: !g ? "first" : resizing ? "resizing" : "user", off: Math.round(off), above: above });
          glued.set(p, { off: off }); return;
        }
        var d = off - g.off;
        if (Math.abs(d) < 0.5) return;
        if (above) p._jrBottomAnchor -= d;
        p.style.top = (top - d) + "px";
        JR.posLog("glue", p, { d: Math.round(d) });
      });
    }
    var savedTop = container.scrollTop;
    var savedAnchorY = anchorEl ? anchorEl.getBoundingClientRect().top : null;
    // now, while everything is where the reader sees it: the anchor marked and the popups' places to it (live N1d: taken
    // at the anchor's first sight later — its turn a placeholder in the list ChatGPT had collapsed — a popup went 2658 px off)
    var startAnchor = liveAnchor();
    if (startAnchor) glue(startAnchor);
    var userScrolling = false;
    var wheelTimer = null;
    var rafId = null;
    // After a send ChatGPT's virtual list re-measures the turns (T18: heights above the reader swap to estimates
    // and back). A ResizeObserver runs after layout and before paint, so a correction made there is never
    // drawn in the wrong place; the frame loop is only the fallback (R33).
    var ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(function () { correct(); }) : null;
    var observed = [];
    // what a send changes the size of: the chat's content and its footer (the site's box), the anchor turn, the open
    // popups (one grows at Return) — any of them: a correction before the frame is drawn
    function watched(anchor) {
      var pops = st.popupStack.map(function (e) { return e.popup; }).concat(st.activePopup ? [st.activePopup] : []);
      return [container].concat(Array.prototype.slice.call(container.children), [anchor], pops).filter(Boolean);
    }
    function observe(els) {
      if (!ro || (els.length === observed.length && els.every(function (el, i) { return el === observed[i]; }))) return;
      ro.disconnect();
      observed = els;
      els.forEach(function (el) { ro.observe(el); });
    }
    // from the start, not from the first frame (live 11-20, ChatGPT: the list re-laid as the send began moved the popup
    // 52 px, then a ~0.4 s long task of the site's: no frame ran, that frame stayed on screen — the observer corrects
    // before it is drawn)
    observe(watched(startAnchor));

    function markUser(e) {
      // Typing or clicking in a popup (Return, the send arrow) isn't scrolling the chat (R33)
      // composedPath: sending removes the question box before the event gets here, so e.target is no longer in the popup
      if ((e.type === "keydown" || e.type === "pointerdown") && e.composedPath().some(function (n) { return n.classList && n.classList.contains("jr-popup"); })) return;
      userScrolling = true;
      if (wheelTimer) clearTimeout(wheelTimer);
      wheelTimer = setTimeout(function () { userScrolling = false; }, 800);
    }

    function addListeners(el) {
      el.addEventListener("wheel", markUser, { passive: true });
      el.addEventListener("touchstart", markUser, { passive: true });
      el.addEventListener("touchend", markUser, { passive: true });
      el.addEventListener("keydown", markUser, { passive: true });
      el.addEventListener("pointerdown", markUser, { passive: true });
    }
    function removeListeners(el) {
      el.removeEventListener("wheel", markUser);
      el.removeEventListener("touchstart", markUser);
      el.removeEventListener("touchend", markUser);
      el.removeEventListener("keydown", markUser);
      el.removeEventListener("pointerdown", markUser);
    }

    var nCorrect = 0, diag = location.hash.indexOf("jr-poslog") !== -1;
    function correct() {
      if (diag) html.setAttribute("data-jr-correct-n", ++nCorrect); // (#jr-poslog: how often the hold looks)
      if (!container.isConnected) {
        var fresh = JR.site.scrollContainer();
        if (!fresh) return;
        removeListeners(container);
        container = fresh;
        savedTop = container.scrollTop;
        addListeners(container);
      }

      var anchor = liveAnchor();
      observe(watched(anchor));
      if (anchor) glue(anchor);
      var site = html.getAttribute("data-jr-site-scroll");
      if (site !== siteScroll) { siteScroll = site; savedTop = container.scrollTop; }
      if (userScrolling) {
        savedTop = container.scrollTop;
        // Scrolled out of ChatGPT's list (unmounted): no old position to go back to when it remounts
        savedAnchorY = anchor ? anchor.getBoundingClientRect().top : null;
      } else {
        if (anchor && savedAnchorY === null) {
          savedAnchorY = anchor.getBoundingClientRect().top;
        } else if (anchor) {
          // The anchor turn stays where it is on screen in every drawn frame — even while ChatGPT draws it
          // as a placeholder: what the reader looks at doesn't move.
          var currentY = anchor.getBoundingClientRect().top;
          var drift = currentY - savedAnchorY;
          if (Math.abs(drift) > 1) {
            if (Math.abs(drift) > 40) JR.posLog("lock", st.activePopup || document.documentElement, { drift: Math.round(drift), top: Math.round(container.scrollTop) });
            // savedTop stays where the user was: ChatGPT re-creates every turn after a send, and a correction made
            // in that collapsed list is fake; when the anchor turn is gone we go back to savedTop (R33, T14)
            container.scrollTop += drift;
          }
        } else if (container.scrollTop !== savedTop) {
          container.scrollTop = savedTop;
        }
      }
    }
    function frame() { correct(); rafId = requestAnimationFrame(frame); }
    rafId = requestAnimationFrame(frame);
    JR.holdNow = correct; // (injectAndSend: right after the site's send)

    addListeners(container);

    return function unlock() {
      if (JR.holdNow === correct) JR.holdNow = null;
      if (rafId) cancelAnimationFrame(rafId);
      mark(null);
      if (ro) ro.disconnect();
      removeListeners(container);
      if (wheelTimer) clearTimeout(wheelTimer);
    };
  };

  /** User-facing reason for a failed send, from the last injection report. */
  var failureText = JR.sendFailureText = function () {
    var r = st.lastSendReport;
    if (!r || r.ok) return "Couldn’t get a response";
    if (r.stage === "composer") return "Popup couldn’t find " + JR.site.label + "’s input box — nothing was sent";
    if (r.stage === "insert") return "Popup couldn’t type into " + JR.site.label + "’s input box — nothing was sent";
    if (r.stage === "submit") return "Popup couldn’t press Send — nothing was sent";
    if (r.stage === "offline") return "You’re offline — nothing was sent";
    if (r.stage === "turn-not-found") return JR.site.label + " answered, but Popup couldn’t find the answer on the page";
    return "Couldn’t get a response";
  };

  /**
   * Watch for the Q&A turn created by our send, hide it, stream the answer
   * into the popup and save the result. Returns { failInjection(report) }.
   * @param {object} snap - JR.snapshotTurns() taken right before sending
   * @param {string} message - the exact injected message (used to recognise the new turn)
   */
  JR.waitForResponse = function (popup, snap, text, sentence, blockTypes, unlockScroll, parentId, question, editOpts, preRegisteredHlId, preRegisteredItemId, message, wholeResponse, wholeResponseFull, files) {
    // Resolve the parent's active item id at call time (for parentItemId tracking)
    var parentItemId = resolveParentItemId(null, parentId);
    st.responseWatchActive = true;
    var convUrl = location.href; // storage writes go to this conversation even if the user navigates away
    // Turns already hidden before this send belong to earlier Popup Q&As. One that
    // remounts during this send can look new (same message prefix when asked from
    // the same sentence): never claim it.
    var hiddenBefore = new Set(st.hiddenTurnKeys);
    var startTime = Date.now();
    // Give up only when nothing has happened for a while, never mid-answer:
    // slow models think or search for minutes before (and between) words.
    var IDLE_LIMIT_MS = 100000;       // ChatGPT not generating and no new text
    var GENERATING_LIMIT_MS = 600000; // ChatGPT says it is generating, but no new text
    var timerId = null;
    var qaKeys = [];          // keys of the turn(s) holding our Q&A (1 in the new DOM, 2 in the legacy DOM)
    var responseTurn = null;  // element holding the answer (re-found by key if ChatGPT remounts it)
    var responseKey = null;
    var detached = false;
    var detachedSpans = null;
    var detachedHlId = editOpts ? editOpts.hlId : null;
    var injectionFailed = false;

    // Answer text from ChatGPT's network stream (net-tap.js, MAIN world). Used
    // when the answer's turn isn't in the DOM (virtualized away) or ChatGPT
    // failed to render it; ChatGPT's own DOM rendering is preferred otherwise.
    var net = { matched: false, text: "", done: false };
    var resumeLook = { n: 0, busy: false };
    // The popup's mirror of ChatGPT's own rendering, once there is one. ChatGPT's virtual list drops the hidden
    // Q&A turn when it ends (R36-1: 1 s before done), so the mirror stays the answer: never switch to Popup's
    // Markdown drawing then (that switch and the later upgrade were the two shifts after streaming, R36f)
    var mirrorDiv = null;
    var rejected = { count: 0, pending: false };
    function onNet(e) {
      var d;
      try { d = JSON.parse(e.detail); } catch (err) { return; }
      if (d.kind === "start") {
        net.matched = !!message && norm60(d.question) === norm60(message);
        return;
      }
      if (!net.matched) return;
      if (JR.perf) JR.perf.count("netEvents");
      if (d.kind === "turn") {
        // The stream names our Q&A turn even when it never mounts: hide it now
        // and save the key, so it stays hidden and can be read back later.
        if (d.turnKey && qaKeys.indexOf(d.turnKey) === -1) {
          qaKeys.push(d.turnKey); // responseKey stays unset until the turn mounts, so the DOM stream observer attaches then
          st.watchingTurnKey = d.turnKey;
          if (JR.site.keepMounted) JR.site.keepMounted(d.turnKey); // DeepSeek: draw it (unseen) to mirror its own rendering
          JR.hideTurnKeys([d.turnKey]);
          // (one write: kept hidden even if the item wasn't stored, and linked to the item)
          addDeletedTurns(convUrl, [d.turnKey], !editOpts && preRegisteredItemId ? { id: preRegisteredItemId, turnKeys: qaKeys.slice() } : null);
        }
        return;
      }
      net.text = d.text || net.text; // (to tell when it is done, never drawn: the popup shows the site answer only)
      if (d.kind === "done") { net.done = true; net.media = !!d.media; } // (media: an image it made, no text)
      if (d.kind === "resuming") net.resuming = Date.now(); // the stream ended before the answer (see poll)
    }
    document.addEventListener("jr-net", onNet);

    /** ChatGPT's DOM has a usable answer for our turn right now. */
    function domAnswerUsable() {
      var t = liveResponseTurn();
      if (t && JR.site.hasUndrawnWidget(t)) return false; // a copy would show a blank chart or map: the frame's original
      return !!(t && !JR.site.renderFailed(t) && JR.site.assistantText(t).trim());
    }

    /**
     * Save "failed" as a concrete version and rebuild the popup.
     * Works for both new highlights (preRegisteredHlId) and edits (editOpts).
     */
    function saveTimeoutVersion() {
      // Anything our send created stays out of the main chat; record it so it
      // stays hidden after reload too.
      var stray = JR.findNewTurns(snap, message).map(JR.site.turnKey);
      var hideKeys = qaKeys.concat(stray.filter(function (k) { return qaKeys.indexOf(k) === -1; }));
      if (hideKeys.length) {
        JR.hideTurnKeys(hideKeys);
        addDeletedTurns(convUrl, hideKeys);
      }

      var hlId = editOpts ? editOpts.hlId : (preRegisteredHlId || detachedHlId);
      if (!hlId) return;
      var memEntry = st.completedHighlights.get(hlId);
      if (!memEntry) return;
      memEntry._jrFailReason = failureText(); // shown by this popup only, not by others

      if (editOpts) {
        // Edit: create a new version item that failed
        var newItemId = crypto.randomUUID();
        memEntry.items.push({ id: newItemId, question: question, status: "failed", turnKeys: hideKeys,
          _files: memEntry._editFiles, _failedFiles: memEntry._editFailed, attachments: (memEntry._editFiles || []).length });
        memEntry.activeItemIndex = memEntry.items.length - 1;
        memEntry.question = question;
        saveHighlight({
          id: newItemId, quoteId: hlId, text: text, status: "failed", question: question,
          url: convUrl, parentId: parentId || null,
          parentItemId: (memEntry && memEntry.parentItemId) || parentItemId || null,
          sourceTurnKey: memEntry.sourceTurnKey || null, turnKeys: hideKeys, active: true,
          wholeResponse: !!memEntry.wholeResponse, attachments: (memEntry._editFiles || []).length,
        });
      } else {
        // New highlight (pre-registered or detached): update the pending item to failed
        var itemIdx = memEntry.activeItemIndex || 0;
        if (memEntry.items && memEntry.items.length > itemIdx) {
          memEntry.items[itemIdx].status = "failed";
          memEntry.items[itemIdx].turnKeys = hideKeys;
        }
        var updateId = preRegisteredItemId
          || (memEntry.items && memEntry.items[itemIdx] ? memEntry.items[itemIdx].id : null);
        if (updateId) {
          updateHighlightFields(updateId, { status: "failed", turnKeys: hideKeys, question: question }, convUrl);
        }
      }

      // Rebuild popup if it's open for this highlight
      var targetPopup = getStreamTarget() || popup;
      if (targetPopup && targetPopup.isConnected) {
        JR.rebuildPopupAfterEdit(targetPopup, hlId);
      }
      JR.updateNavWidget();
    }

    function cleanup() {
      document.removeEventListener("jr-net", onNet);
      st.responseWatchActive = false;
      st.watchingTurnKey = null;
      if (JR.site.keepMounted) JR.site.keepMounted(null);
      var frozen = JR.unfreezeChat();
      // Turns the freeze hid that turned out not to be ours: show them again.
      var notOurs = frozen.filter(function (k) { return qaKeys.indexOf(k) === -1; });
      if (notOurs.length && qaKeys.length) JR.unhideTurnKeys(notOurs);
      if (detached && mirrorDiv && JR.siteAnswer.current() === mirrorDiv) JR.siteAnswer.stop(); // no popup shows it
      if (unlockScroll) unlockScroll();
      document.querySelectorAll(".jr-popup--streaming").forEach(function (p) { p.classList.remove("jr-popup--streaming"); });
      if (location.hash.indexOf("jr-") !== -1) setTimeout(JR.diagnose, 500); // test tools: keep #jr-diagnostics current after each send
    }

    function finishWithTimeout() {
      cleanup();
      saveTimeoutVersion();
      st.cancelResponseWatch = null;
      JR.drainQueue();
    }

    /**
     * Find the popup that should receive streaming updates.
     */
    function getStreamTarget() {
      if (!detached && popup && popup.isConnected) return popup;
      if (detached && detachedHlId && st.activePopup && st.activePopup.isConnected) {
        // Match by highlight ID — check both span attribute and active state
        if (st.activeHighlightId === detachedHlId) {
          return st.activePopup;
        }
        if (st.activeSourceHighlights.length > 0 &&
            st.activeSourceHighlights[0].getAttribute("data-jr-highlight-id") === detachedHlId) {
          return st.activePopup;
        }
      }
      return null;
    }

    /** The live element for the response turn (ChatGPT may have remounted it). */
    function liveResponseTurn() {
      if (!responseKey) return null;
      if (responseTurn && responseTurn.isConnected) return responseTurn;
      var fresh = JR.site.findTurnByKey(responseKey);
      if (fresh) responseTurn = fresh;
      return fresh;
    }

    /**
     * While it streams, the popup it goes to (when active: only the active popup follows an original) shows the site
     * answer: its answer area follows our answer's original (site-answer.js, design A) — node by node, as fast as the
     * site draws it. Called on start and on every poll (the popup may have closed, reopened, or another be active).
     */
    function streamInto() {
      var targetPopup = getStreamTarget();
      if (!targetPopup || targetPopup !== st.activePopup || !responseKey) return;
      var turn = liveResponseTurn(); // (its answer drawn on the page first: an empty placeholder would send it elsewhere)
      if (!turn || !JR.site.assistantBodies(turn).length) return;
      var responseDiv = targetPopup.querySelector(".jr-popup-response");
      if (responseDiv && JR.siteAnswer.current() === responseDiv && followedKeys === qaKeys.join()) return; // it does
      if (!responseDiv) {
        responseDiv = document.createElement("div");
        responseDiv.className = "jr-popup-response";
      }
      followedKeys = responseDiv._jrKeys = qaKeys.join(); // (the popup keeps this area when the answer is done: showAnswer)
      JR.siteAnswer.follow(responseDiv, qaKeys.slice(), function () {
        if (JR.perf) JR.perf.count("streamSync");
        // ChatGPT mounts an empty answer placeholder first: keep "Loading…" until text arrives
        if (!responseDiv.textContent.trim()) return;
        mirrorDiv = responseDiv;
        JR.typeAnswer(targetPopup); // the new text stays hidden until it is typed out, from this same frame on
        targetPopup.classList.add("jr-popup--streaming");
        if (!responseDiv.parentNode) {
          var loadingEl = targetPopup.querySelector(".jr-popup-loading");
          if (loadingEl) loadingEl.remove();
          targetPopup.appendChild(responseDiv);
          JR.repositionPopup(); // a new answer area: the arrow moves to it
        }
        if (JR.wireResponseClicks) JR.wireResponseClicks(responseDiv);
        JR.followAnswer(responseDiv);
      });
    }
    var followedKeys = "";

    // Closing the popup mid-answer detaches: the watch keeps running and saves
    // the answer to the highlight in the background.
    st.cancelResponseWatch = function () {
      detachedSpans = st.activeSourceHighlights.slice();
      detached = true;

      if (editOpts) {
        // Edit mode detach — spans and entry already exist
        // detachedHlId already set from editOpts.hlId
        // Keep observer running — streaming continues in background
        if (unlockScroll) unlockScroll();
        unlockScroll = null;
        st.cancelResponseWatch = null;
        return;
      }

      if (preRegisteredHlId) {
        // Use pre-registered entry from doSend
        detachedHlId = preRegisteredHlId;
      } else {
        detachedHlId = crypto.randomUUID();
        var contentContainer = JR.site.popupHost(JR.site.turnOf(detachedSpans[0]));
        for (var k = 0; k < detachedSpans.length; k++) {
          detachedSpans[k].setAttribute("data-jr-highlight-id", detachedHlId);
          detachedSpans[k].classList.add("jr-source-highlight-done");
        }
        var detachEntry = {
          quoteId: detachedHlId,
          spans: detachedSpans.slice(),
          text: text,
          sentence: sentence,
          blockTypes: blockTypes,
          question: question || null,
          contentContainer: contentContainer,
          parentId: parentId || null,
          parentItemId: parentItemId || null,
          sourceTurnKey: JR.getTurnKey(detachedSpans[0]),
          items: [],
          activeItemIndex: 0,
        };
        st.completedHighlights.set(detachedHlId, detachEntry);
      }

      // Keep observer running — streaming continues in background
      if (unlockScroll) unlockScroll();
      unlockScroll = null;
      st.cancelResponseWatch = null;
    };
    // its popup closed while the send waited in the queue (peer audit A1): the watch starts detached, as if closed now —
    // a popup opened again on it gets the answer (it showed Loading… for good)
    if (popup && !popup.isConnected && (editOpts || preRegisteredHlId)) {
      var waitedEntry = st.completedHighlights.get(editOpts ? editOpts.hlId : preRegisteredHlId);
      var shown = st.activeSourceHighlights;
      st.activeSourceHighlights = waitedEntry && waitedEntry.spans ? waitedEntry.spans.slice() : [];
      st.cancelResponseWatch();
      st.activeSourceHighlights = shown;
    }

    function captureResponse() {
      var spans = detached ? detachedSpans : st.activeSourceHighlights;

      var turn = liveResponseTurn();
      // the answer's text, for ordering highlights in it only (the popup shows the site answer from its original)
      var answerText = domAnswerUsable() ? JR.site.assistantText(turn).trim()
        : mirrorDiv ? mirrorDiv.textContent.trim() : ""; // (the hidden turn is gone: what the popup showed of it, R36f)
      if (!answerText && turn && !net.text.trim()) {
        // Empty answer (user stopped, error): failed
        finishWithTimeout();
        return;
      }
      // Done. Not in the DOM, ChatGPT's "couldn't load", a chart it draws only on screen: "Loading…" until the site
      // answer comes from its original elsewhere (the render frame, DeepSeek's kept item; user 2026-11-18, no backup).
      if (answerText) qaKeys.forEach(function (k) {
        JR.qa.put(k, { question: question, text: text, sentence: sentence, answerText: answerText, isPopup: true });
      });
      cleanup();

      var sourceTurnKey = spans.length > 0 ? JR.getTurnKey(spans[0]) : null;

      // --- Edit mode: save new item with same quoteId ---
      if (editOpts) {
        var hlId = editOpts.hlId;

        // Update in-memory entry
        var memEntry = st.completedHighlights.get(hlId);
        var newItemId = crypto.randomUUID();
        if (memEntry) {
          memEntry.items.push({ id: newItemId, question: question, status: "done", turnKeys: qaKeys.slice(),
            _files: memEntry._editFiles, _failedFiles: memEntry._editFailed, attachments: (memEntry._editFiles || []).length });
          memEntry.activeItemIndex = memEntry.items.length - 1;
          memEntry.question = question;
        }

        // Persist new item (deactivates old items with same quoteId; old items keep their own turn keys)
        saveHighlight({
          id: newItemId,
          quoteId: hlId,
          text: text,
          status: "done",
          url: convUrl,
          parentId: parentId || null,
          parentItemId: resolveParentItemId(memEntry, parentId) || parentItemId || null,
          sourceTurnKey: (memEntry && memEntry.sourceTurnKey) || sourceTurnKey,
          turnKeys: qaKeys,
          active: true,
          wholeResponse: memEntry ? !!memEntry.wholeResponse : false,
          attachments: memEntry ? (memEntry._editFiles || []).length : 0,
        });

        // Rebuild popup UI if it's still open for this highlight
        var editPopupOpen = false;
        if (!detached && popup && popup.isConnected) {
          JR.rebuildPopupAfterEdit(popup, hlId);
          editPopupOpen = true;
        } else if (detached && st.activePopup && (st.activeHighlightId === hlId ||
                   (st.activeSourceHighlights.length > 0 && st.activeSourceHighlights[0].getAttribute("data-jr-highlight-id") === hlId))) {
          JR.rebuildPopupAfterEdit(st.activePopup, hlId);
          editPopupOpen = true;
        }

        // Only claim active highlight if the popup is still showing this highlight
        if (editPopupOpen) {
          st.activeHighlightId = hlId;
          JR.syncHighlightActive(hlId);
        }
        JR.updateNavWidget();
        st.cancelResponseWatch = null;
        JR.drainQueue();
        return;
      }

      // --- Normal (non-edit) capture ---
      var hlId2;
      var entry = null;
      var itemId2 = null;

      function fillItem(e, itemId) {
        e.question = e.question || question || null;
        if (!e.sourceTurnKey) e.sourceTurnKey = sourceTurnKey;
        var found = false;
        if (e.items && itemId) {
          for (var di = 0; di < e.items.length; di++) {
            if (e.items[di].id === itemId) {
              e.items[di].status = "done";
              e.items[di].turnKeys = qaKeys.slice();
              found = true;
              break;
            }
          }
        }
        if (!found && e.items && e.items.length > 0 && (e.items[0].status === "pending" || !itemId)) {
          e.items[0].status = "done";
          e.items[0].turnKeys = qaKeys.slice();
          found = true;
        }
        if (!found && (!e.items || e.items.length === 0)) {
          e.items = [{ id: crypto.randomUUID(), question: question || null, status: "done", turnKeys: qaKeys.slice() }];
          e.activeItemIndex = 0;
        }
      }

      if (detached) {
        hlId2 = detachedHlId;
        entry = st.completedHighlights.get(hlId2);
        if (entry) fillItem(entry, preRegisteredItemId);

        if (st.activePopup && (st.activeHighlightId === hlId2 ||
            (st.activeSourceHighlights.length > 0 && st.activeSourceHighlights[0].getAttribute("data-jr-highlight-id") === hlId2))) {
          st.activeHighlightId = hlId2;
          JR.syncHighlightActive(hlId2);
          JR.rebuildPopupAfterEdit(st.activePopup, hlId2);
        }
      } else if (preRegisteredHlId) {
        // Update pre-registered pending entry with real response
        hlId2 = preRegisteredHlId;
        entry = st.completedHighlights.get(hlId2);
        if (entry) fillItem(entry, preRegisteredItemId);
        // Rebuild popup into completed view (editable question, version nav)
        if (popup && popup.isConnected) {
          st.activeHighlightId = hlId2;
          JR.syncHighlightActive(hlId2);
          JR.rebuildPopupAfterEdit(popup, hlId2);
        }
      } else {
        hlId2 = crypto.randomUUID();
        itemId2 = crypto.randomUUID();
        if (spans.length > 0) {
          for (var k = 0; k < spans.length; k++) {
            spans[k].setAttribute("data-jr-highlight-id", hlId2);
            spans[k].classList.add("jr-source-highlight-done");
          }
          st.completedHighlights.set(hlId2, {
            quoteId: hlId2,
            spans: spans.slice(),
            text: text,
            sentence: sentence,
            blockTypes: blockTypes,
            question: question || null,
            contentContainer: popup.parentElement,
            parentId: parentId || null,
            parentItemId: parentItemId || null,
            sourceTurnKey: sourceTurnKey,
            items: [{ id: itemId2, question: question || null, status: "done", turnKeys: qaKeys.slice() }],
            activeItemIndex: 0,
          });
        }

        // Rebuild popup into completed view (editable question, version nav)
        if (popup && popup.isConnected) {
          st.activeHighlightId = hlId2;
          JR.syncHighlightActive(hlId2);
          JR.rebuildPopupAfterEdit(popup, hlId2);
        }
      }

      // Determine the item id to persist
      var persistItemId = preRegisteredItemId
        || (detached && entry && entry.items && entry.items[0] ? entry.items[0].id : itemId2);

      if (preRegisteredItemId || (detached && preRegisteredHlId)) {
        // Update the existing pending storage record
        updateHighlightFields(persistItemId, {
          status: "done",
          turnKeys: qaKeys,
          sourceTurnKey: (entry && entry.sourceTurnKey) || sourceTurnKey,
        }, convUrl);
      } else {
        saveHighlight({
          id: persistItemId,
          quoteId: hlId2,
          text: text,
          status: "done",
          url: convUrl,
          parentId: parentId || null,
          parentItemId: parentItemId || null,
          sourceTurnKey: sourceTurnKey,
          turnKeys: qaKeys,
        });
      }

      JR.updateNavWidget();
      st.cancelResponseWatch = null;
      JR.drainQueue();
    }

    var lastContentSnapshot = "";
    var lastNetLength = 0;
    var lastProgress = Date.now();     // last time the answer grew (DOM or network)
    var STALE_THRESHOLD = 60000; // generating flag stuck: answer unchanged this long → capture what is there
    var savedKeys = false;

    function poll() {
      if (injectionFailed) return;

      // 1. Recognise the turn(s) our send created.
      var fresh = JR.findNewTurns(snap, message);
      if (fresh.length) {
        var added = [];
        for (var fi = 0; fi < fresh.length; fi++) {
          var fk = JR.site.turnKey(fresh[fi]);
          if (fk && qaKeys.indexOf(fk) === -1 && !hiddenBefore.has(fk)) { qaKeys.push(fk); added.push(fk); }
        }
        if (added.length) {
          JR.hideTurnKeys(added);
          st.watchingTurnKey = qaKeys[qaKeys.length - 1];
          // Persist right away so a reload mid-answer still hides the Q&A and
          // can read the answer back (the item loads instead of "failed").
          addDeletedTurns(convUrl, added, !editOpts && preRegisteredItemId ? { id: preRegisteredItemId, turnKeys: qaKeys.slice() } : null);
          if (!savedKeys) { savedKeys = true; JR.repositionPopup(); }
        }
        if (!responseKey) {
          for (var ri = fresh.length - 1; ri >= 0; ri--) {
            if (JR.site.hasAssistant(fresh[ri])) {
              responseTurn = fresh[ri];
              responseKey = JR.site.turnKey(responseTurn);
              streamInto();
              break;
            }
          }
        }
      }

      streamInto();
      var turn = liveResponseTurn();
      var generating = JR.isGenerating();

      // 2. Done: ChatGPT stopped generating and the answer has text.
      if (turn && !generating && JR.site.assistantText(turn).trim().length > 0) {
        setTimeout(captureResponse, 300);
        return;
      }
      // Done per the network stream while the DOM answer isn't usable
      // (turn never mounted, or ChatGPT's "couldn't load").
      if (net.done && (net.text.trim() || net.media) && !domAnswerUsable()) {
        setTimeout(captureResponse, 300);
        return;
      }
      // Done while the answer is scrolled out of the DOM (keys known, content later).
      if (responseKey && !turn && !generating && !net.matched) {
        setTimeout(captureResponse, 300);
        return;
      }

      // Progress: the answer grew in the DOM or in the network stream.
      var currentContent = turn ? JR.site.assistantText(turn) : "";
      if (currentContent !== lastContentSnapshot || net.text.length !== lastNetLength) {
        lastContentSnapshot = currentContent;
        lastNetLength = net.text.length;
        lastProgress = Date.now();
      }

      // Stale-content safeguard: generating flag stuck but the (mounted) answer stopped changing.
      // (not while the network stream is still open: ChatGPT may be searching or running code)
      if (turn && generating && !(net.matched && !net.done)) {
        if (currentContent.trim() && Date.now() - lastProgress >= STALE_THRESHOLD) {
          console.warn("[Popup] Response stale for " + STALE_THRESHOLD + "ms — force capturing");
          setTimeout(captureResponse, 300);
          return;
        }
      }

      // ChatGPT refused the send ("wait for this response to finish") and put
      // our message back in its input box: clear it at once (the user must never
      // see it), then send again when ChatGPT is really idle — once.
      if (!qaKeys.length && !net.matched && !rejected.pending && !submitting && Date.now() - startTime >= 1500) {
        var composer = JR.site.composer();
        var probe = norm60(message).slice(0, 30);
        if (composer && probe && norm60(JR.site.composerText(composer)).indexOf(probe) !== -1) {
          clearComposer(composer, files);
          putDraftBack(composer, lastDraft); // (the user's own text came back to the box with it)
          handBackFiles();
          // With files, a resend would go out as text only: fail instead (Retry resends the files). With the user's
          // own files set aside, they were handed back at the first send: a resend would carry them, hidden (audit)
          if (rejected.count >= 1 || (files && files.length) || lastHadAside) {
            st.lastSendReport = { ok: false, stage: "rejected", detail: "ChatGPT refused the message twice", when: new Date().toISOString() };
            finishWithTimeout();
            return;
          }
          rejected.count++;
          rejected.pending = true;
          st.lastSendReport = { ok: false, stage: "retrying", detail: "ChatGPT was still busy; will resend", when: new Date().toISOString() };
          (function resendWhenIdle(tries) {
            if (JR.isGenerating() && tries < 120) { setTimeout(function () { resendWhenIdle(tries + 1); }, 500); return; }
            snap = JR.snapshotTurns();
            startTime = Date.now();
            rejected.pending = false;
            JR.injectAndSend(message, function (r) { if (!r.ok) watch.failInjection(r); });
          })(0);
        }
      }
      if (rejected.pending) { timerId = setTimeout(poll, 300); return; }

      // Quick timeout: nothing appeared and ChatGPT isn't generating.
      if (!qaKeys.length && !net.matched && !generating && Date.now() - startTime >= 3000) {
        finishWithTimeout();
        return;
      }

      // ChatGPT is answering but our turn never mounted (user scrolled far away).
      if (!qaKeys.length && !net.matched && generating && Date.now() - startTime >= 4000 && (!st.lastSendReport || st.lastSendReport.ok)) {
        st.lastSendReport = { ok: false, stage: "turn-not-found", detail: "ChatGPT is generating but the new turn is not in the DOM", when: new Date().toISOString() };
      }

      // The send's stream ended before the answer (ChatGPT's thinking models resume it on another connection, live
      // 11-20): once ChatGPT is done, the Q&A and its answer from the conversation (up to 6 looks, 3 s apart)
      if (net.resuming && !net.done && !generating && !resumeLook.busy && resumeLook.n < 6 && Date.now() - net.resuming >= 1500) {
        resumeLook.busy = true; resumeLook.n++;
        JR.qa.answerFor(message).then(function (a) {
          resumeLook.busy = false;
          if (!a) { net.resuming = Date.now() + 1500; return; }
          onNet({ detail: JSON.stringify({ kind: "turn", turnKey: a.turnKey }) });
          net.text = a.text; net.media = a.media; net.done = true;
        }, function () { resumeLook.busy = false; });
      }

      // Hard 10-second timeout: no answer text and ChatGPT isn't working on it.
      if (Date.now() - startTime >= 10000) {
        var hasRealContent = (turn && JR.site.assistantText(turn).trim().length >= 1) || net.text.trim().length >= 1 || net.media;
        if (!hasRealContent && !generating && !(net.matched && !net.done)) {
          finishWithTimeout();
          return;
        }
      }

      if (Date.now() - Math.max(startTime, lastProgress) >= (generating ? GENERATING_LIMIT_MS : IDLE_LIMIT_MS)) {
        stopGeneration();
        finishWithTimeout();
        return;
      }

      // Poll fast initially to catch new turns quickly, then slow down
      var interval = responseKey ? 500 : 80;
      timerId = setTimeout(poll, interval);
    }

    timerId = setTimeout(poll, 80);

    var watch = {
      /** The injection itself failed: stop watching, undo, and say why in the popup. */
      failInjection: function () {
        injectionFailed = true;
        if (timerId) clearTimeout(timerId);
        cleanup();
        saveTimeoutVersion();
        st.cancelResponseWatch = null;
        JR.drainQueue();
      },
    };
    return watch;
  };
})();

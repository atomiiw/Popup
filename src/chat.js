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
    // (resuming: that stream ended too — the answer goes on elsewhere; counted open, ChatGPT stayed "generating" for
    // good and every later Popup question waited in the queue on Loading… — audit 11-20, from 736ef16)
    else if (kind === "done" || kind === "resuming") st.netActive = Math.max(0, st.netActive - 1);
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
    // the whole box too (ChatGPT's new front end: its layout around the input grew 8 px with Popup's text, and the
    // chat above it moved for ~0.2 s — drawn record 11-20)
    var box = JR.site.composerBox ? JR.site.composerBox(chatInput) : null, boxH = box ? box.offsetHeight : 0;
    if (box && boxH) box.setAttribute("data-jr-injecting-box", "");
    // ...and every layer between the input and the box (its row of buttons moved 8 px inside the held box — drawn record)
    var held = [];
    for (var up = chatInput.parentElement && chatInput.parentElement.parentElement; up && box && up !== box && box.contains(up); up = up.parentElement) {
      up.style.setProperty("--jr-ih", up.offsetHeight + "px");
      up.setAttribute("data-jr-injecting-hold", "");
      held.push(up);
    }
    chatInput.setAttribute("data-jr-injecting", "");
    var hideStyle = document.createElement("style");
    hideStyle.id = "jr-hide-style";
    hideStyle.textContent =
      "[data-jr-injecting], [data-jr-injecting] * { color: transparent !important; caret-color: transparent !important; }" +
      // (min too: the draft set aside, a box of several lines got shorter and the chat moved — live round 5, claude.ai)
      "\n:has(> [data-jr-injecting]) { max-height: " + composerH + "px !important; min-height: " + composerH + "px !important; overflow: hidden !important; }" +
      (boxH ? "\n[data-jr-injecting-box] { max-height: " + boxH + "px !important; min-height: " + boxH + "px !important; overflow: hidden !important; }" : "") +
      // (the input itself too: it grew a line with Popup's text and its row of buttons moved 8 px — drawn record)
      "\n[data-jr-injecting] { max-height: " + chatInput.offsetHeight + "px !important; overflow: hidden !important; }" +
      "\n[data-jr-injecting-hold] { max-height: var(--jr-ih) !important; min-height: var(--jr-ih) !important; overflow: hidden !important; }";
    document.head.appendChild(hideStyle);
    function unhideComposer() {
      hideStyle.remove();
      chatInput.removeAttribute("data-jr-injecting");
      if (box) box.removeAttribute("data-jr-injecting-box");
      held.forEach(function (el) { el.removeAttribute("data-jr-injecting-hold"); el.style.removeProperty("--jr-ih"); });
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
    // another chat opened: nothing of it is held (the hold outlives a closed popup till its send ends — NT2 G2)
    var conv = JR_HOST.convKey(location.href), done = false;
    var away = setInterval(function () { if (JR_HOST.convKey(location.href) !== conv) release(); }, 500);
    st.releaseHold = release; // (content.js onNavigate: at once, not up to 500 ms later — review)
    function release() {
      if (done) return;
      done = true;
      if (st.releaseHold === release) st.releaseHold = null;
      clearInterval(away);
      clearInterval(renew);
      // claude.ai keeps following its newest message after a send (pinned to the bottom): let go first, or its next
      // change scrolls the reader there once the guard is off (live 2026-11-19, Claude Code: to the end of the chat)
      if (JR.site.unpin) JR.site.unpin();
      document.documentElement.removeAttribute("data-jr-scroll-lock");
      if (unlock) unlock();
    }
    return release;
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

  /** Another chat opened: the questions still waiting to be sent are not sent — each stored failed at once in its own
   *  chat (they stayed pending and failed only when their popup was next opened — A1 exploration). Retry resends. */
  JR.dropQueue = function () {
    st.messageQueue.splice(0).forEach(function (opts) {
      var w = opts.waitOpts || {}, id = w.preRegisteredItemId || (w.editOpts && w.editOpts.itemId);
      if (id) updateHighlightFields(id, { status: "failed", onlyIfPending: true }, opts.url || location.href);
    });
  };

  /** Still the chat of url (by conversation: a #hash or ?artifact= is the same chat). */
  function sameChat(url) { return JR_HOST.convKey(url) === JR_HOST.convKey(location.href); }

  function sendQueued(opts) {
    // its highlight deleted while it waited (peer audit A1): not sent
    var qw = opts.waitOpts || {}, qid = qw.editOpts ? qw.editOpts.hlId : qw.preRegisteredHlId;
    if (qid && !st.completedHighlights.has(qid)) { JR.drainQueue(); return; }
    // another chat opened while it waited (the URL check runs every 500 ms, the queue every 300): never sent there
    // (the conversation, not the URL: claude.ai's Settings change the hash)
    if (opts.url && !sameChat(opts.url)) { st.messageQueue.unshift(opts); JR.dropQueue(); return; }
    // its availability: sending from here — its files' upload included (a reopen meanwhile saw idle and stored it
    // failed — ponytail review); once per send (sendQueued comes back here after the files)
    var avId = qw.preRegisteredItemId || (qw.editOpts && qw.editOpts.itemId); // (an edit's version too)
    if (avId && !opts.availSent) { opts.availSent = true; JR.availability.on(avId, { t: "send", files: !!(opts.files && opts.files.length) }); }
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
          // another chat opened meanwhile: never sent there (by conversation, not URL: a hash / ?artifact= is the same
          // chat — the send was dropped silently and its popup stayed Loading…, audit L5)
          if (sameChat(from)) sendQueued(opts); else { immediateTimeout(opts.waitOpts, from); JR.drainQueue(); }
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
        if (!sameChat(startUrl)) { // the user opened another chat meanwhile: never send there (failed, the queue goes on)
          removeComposerAttachments(JR.site.composer(), res.sent);
          endAttaching();
          JR.dropAsideFiles();
          immediateTimeout(opts.waitOpts, startUrl);
          JR.drainQueue();
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
    var vid = w.preRegisteredItemId || (w.editOpts && w.editOpts.itemId); // (its availability: sending since sendQueued began, streaming once in)
    JR.injectAndSend(opts.message, function (r) {
      endAttaching();
      if (r.ok && vid) JR.availability.on(vid, { t: "sent" });
      if (!r.ok && watch) watch.failInjection(r);
    });
  }

  /**
   * Mark "failed" at once for a message that was never sent (e.g. offline).
   * Mirrors saveTimeoutVersion logic but without needing a waitForResponse context.
   */
  /** Put a version into its entry's versions: replacing the one with its id (stored when sent, then read back from
   *  storage on returning to the chat — review A1 #2), else added; it becomes the one shown. */
  function putVersion(memEntry, item) {
    var i = memEntry.items.findIndex(function (x) { return x.id === item.id; });
    if (i >= 0) memEntry.items[i] = item; else i = memEntry.items.push(item) - 1;
    memEntry.activeItemIndex = i;
  }

  function immediateTimeout(w, url) { // url: the chat it was asked in (another may be open now — ponytail review)
    url = url || location.href;
    var avFail = w.preRegisteredItemId || (w.editOpts && w.editOpts.itemId);
    if (avFail) JR.availability.on(avFail, { t: "failed", reason: "not-sent" });
    JR.unfreezeChat();
    if (w.unlockScroll) w.unlockScroll();
    var hlId = w.editOpts ? w.editOpts.hlId : (w.preRegisteredHlId || null);
    if (!hlId) return;
    var memEntry = st.completedHighlights.get(hlId);
    if (!memEntry) return;

    if (w.editOpts) {
      var newItemId = w.editOpts.itemId || crypto.randomUUID(); // (stored when sent: replaced — review A1 #1)
      putVersion(memEntry, { id: newItemId, question: w.question, status: "failed", turnKeys: [],
        _files: memEntry._editFiles, _failedFiles: memEntry._editFailed, attachments: (memEntry._editFiles || []).length });
      memEntry.question = w.question;
      saveHighlight({
        id: newItemId, quoteId: hlId, text: memEntry.text, status: "failed",
        url: url, parentId: memEntry.parentId || null, parentItemId: memEntry.parentItemId || null,
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
        updateHighlightFields(updateId, { status: "failed" }, url);
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
  var anchorSeq = 0; // CSS anchor names of the send's popups (lockScroll)
  JR.lockScroll = function (container, anchorEl, opts) {
    // opts.chatOnly: the chat held, the popups left to their own placing (a jump's settle — popup-helpers.js: its new
    // popup still growing to its answer and placing itself; glued, it was put back 470 px up, off screen — live NT4 A2)
    var withPopups = !(opts && opts.chatOnly);
    // Anchor on the anchor's turn (by key): ChatGPT rebuilds turn DOM while the
    // virtual list re-measures, which detaches the original element.
    var hint = anchorEl, anchorKey = anchorEl ? JR.getTurnKey(anchorEl) : null;
    if (anchorKey) anchorEl = JR.site.findTurnByKey(anchorKey) || anchorEl;
    // …and inside it on the passage the reader sees (live NT4 A1, ChatGPT: the reader mid-way through a long answer;
    // at the send ChatGPT laid that turn out anew — its top held where it was, its inside not: the screen showed the
    // next turn, and the site's scrolls that kept the turn's top went through). A block by its text, found again in
    // the turn each time it is redrawn; where it isn't (being drawn), the turn. Each with its own place on screen.
    var BLOCK = "p, li, h1, h2, h3, h4, h5, h6, pre, blockquote, td";
    var point = null, pointEl = null, kind = "turn", saved = { turn: null, block: null };
    function blockText(b) { return (b.textContent || "").trim().slice(0, 80); }
    function pickPoint(turn, near) {
      point = null; pointEl = null;
      if (!turn || !turn.querySelectorAll) return;
      var b = near && near.closest && near.closest(BLOCK), band = JR.site.visibleBand();
      if (!b || !turn.contains(b)) {
        // the one at the upper third of the view (what is read), else the first starting in it — not one that only
        // ends at its top edge (its own top far above)
        var all = Array.prototype.slice.call(turn.querySelectorAll(BLOCK)), y = band.top + (band.bottom - band.top) / 3;
        b = all.filter(function (x) { var r = x.getBoundingClientRect(); return r.height && r.top <= y && r.bottom > y; }).pop() ||
          all.filter(function (x) { var r = x.getBoundingClientRect(); return r.height && r.top >= band.top && r.top < band.bottom; })[0];
      }
      var text = b && blockText(b);
      if (!text || text.length < 12) return; // (too short to be found again)
      var same = Array.prototype.filter.call(turn.querySelectorAll(BLOCK), function (x) { return blockText(x) === text; });
      point = { text: text, nth: same.indexOf(b) };
      pointEl = b;
    }
    function findPoint(turn) {
      if (!point || !turn) return null;
      if (pointEl && pointEl.isConnected && turn.contains(pointEl)) return pointEl;
      var same = Array.prototype.filter.call(turn.querySelectorAll(BLOCK), function (x) { return blockText(x) === point.text; });
      pointEl = same[point.nth] || same[0] || null;
      return pointEl;
    }
    // The turns around the reader's in page order, each with its height as drawn (the largest seen — ChatGPT draws a turn
    // it lays out anew as a 130 px placeholder first). Where the reader's turn is taken off the page, a turn near it
    // that is drawn whole tells where it is: by the heights between (live NT13 G2, ChatGPT: it measured the 21 000 px
    // turns above anew, kept another turn in place, and the reader's went 9 000 px down and off the page; each search
    // for it laid the list out as placeholders again — three rounds, then another osmosis answer on screen)
    var chain = [], tall = {};
    function pageTurns() { return Array.prototype.slice.call(container.querySelectorAll(JR.SEL.turn)); }
    function learnChain() {
      chain = pageTurns().map(function (t) {
        var k = JR.site.turnKey(t), h = t.getBoundingClientRect().height;
        if (k && h > (tall[k] || 0)) tall[k] = h;
        return k;
      });
    }
    /** Where the reader's turn's top is on screen now, from a near turn drawn whole; null if none. */
    function placeFromChain() {
      var i = chain.indexOf(anchorKey), best = null;
      if (i < 0) return null;
      pageTurns().forEach(function (t) {
        var k = JR.site.turnKey(t), j = chain.indexOf(k), r;
        if (j < 0 || j === i || !tall[k] || Math.abs((r = t.getBoundingClientRect()).height - tall[k]) > 2) return; // (a placeholder)
        if (!best || Math.abs(j - i) < Math.abs(best.j - i)) best = { j: j, top: r.top };
      });
      if (!best) return null;
      var y = best.top, m;
      if (best.j < i) for (m = best.j; m < i; m++) y += tall[chain[m]] || 0;
      else for (m = i; m < best.j; m++) y -= tall[chain[m]] || 0;
      return y;
    }
    /** The anchor's places on screen now (the turn's and the passage's), for what they are to be held at. */
    function takePlaces(turn) {
      var b = findPoint(turn);
      saved.turn = turn ? turn.getBoundingClientRect().top : null;
      saved.block = b ? b.getBoundingClientRect().top : null;
    }
    // marked for scroll-guard.js (page world): a site scroll keeping it in view goes through
    var marked = null;
    function mark(el) {
      if (el !== marked || (el && !el.hasAttribute("data-jr-anchor"))) { // (another hold's end took it off — review)
        if (marked && marked !== el) { marked.removeAttribute("data-jr-anchor"); marked.removeAttribute("data-jr-anchor-y"); }
        marked = el;
        if (el) el.setAttribute("data-jr-anchor", "");
      }
      // where the reader sees it: a site scroll that keeps it there goes through (scroll-guard.js)
      var y = saved[kind] === null ? null : String(Math.round(saved[kind]));
      if (el && el.getAttribute("data-jr-anchor-y") !== y) {
        if (y === null) el.removeAttribute("data-jr-anchor-y"); else el.setAttribute("data-jr-anchor-y", y);
      }
    }
    var lastSeen = { a: null, t: null }, diag = location.hash.indexOf("jr-poslog") !== -1;
    function liveAnchor() {
      if (!(anchorEl && anchorEl.isConnected) && anchorKey) anchorEl = JR.site.findTurnByKey(anchorKey);
      var t = anchorEl && anchorEl.isConnected ? anchorEl : null, b = t && findPoint(t);
      kind = b ? "block" : "turn";
      var a = b || t;
      if (diag && (a !== lastSeen.a || t !== lastSeen.t)) { // (#jr-poslog: what the hold goes by, each time it changes)
        var hl0 = JR.viewAnchor && st.activeSourceHighlights[0];
        JR.posLog("anchor", st.activePopup || document.documentElement, { kind: kind, sameTurn: t === lastSeen.t, y: a ? Math.round(a.getBoundingClientRect().top) : null,
          hl: hl0 && hl0.isConnected ? Math.round(hl0.getBoundingClientRect().top) : null, inA: !!(hl0 && a && a.contains(hl0)), text: point ? point.text.slice(0, 24) : null });
        lastSeen = { a: a, t: t };
      }
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
    function openPopups() {
      return st.popupStack.map(function (e) { return e.popup; }).concat(st.activePopup ? [st.activePopup] : []).filter(Boolean);
    }
    // A "below" popup is tied to its highlight with CSS anchor positioning while the send runs: the browser places it as
    // it lays out each frame (live 11-20, ChatGPT: the list moved after the hold's last look in that frame — the popup
    // sat 52 px off its highlight ~0.4 s, drawn; no look can be in time). The glue below is for the rest ("above"
    // popups, a browser without anchors, a highlight gone).
    var canAnchor = typeof CSS !== "undefined" && CSS.supports && CSS.supports("top", "anchor(--jr-x top, 0px)");
    function sourceOf(p) {
      if (p === st.activePopup) return st.activeSourceHighlights[0];
      var e = st.popupStack.filter(function (x) { return x.popup === p; })[0];
      return e && e.sourceHighlights && e.sourceHighlights[0];
    }
    function anchorPopups() {
      if (!canAnchor) return;
      openPopups().forEach(function (p) {
        if (!p || !p.isConnected || p._jrAnchorHl) return;
        // an "above" one by its bottom on the highlight's top: it grows up from there (live NT7, ChatGPT: glued by the
        // hold's look, it was drawn off screen ~0.3 s while the site re-laid its list at the send)
        var up = p._jrLockedDirection === "above";
        if (up && p._jrBottomAnchor == null) return;
        var hl = sourceOf(p);
        if (!hl || !hl.isConnected || !hl.getBoundingClientRect().height) return;
        var pr = p.getBoundingClientRect(), hr = hl.getBoundingClientRect(), name = "--jr-a" + (++anchorSeq);
        // (an above one by the bottom it is placed to, not as drawn — live NT9: tied the moment Return made it taller,
        // before its top followed, it was held 49 px low, over its highlight, for the whole send)
        var want = up ? pr.top - (parseFloat(p.style.top) || 0) + p._jrBottomAnchor : pr.top, dy = up ? hr.top - want : pr.top - hr.top;
        // (no anchor: where it is — a below one's top; an above one's bottom, as an inset from its container's bottom)
        var stays = up ? (p.offsetParent ? p.offsetParent.clientHeight : 0) - p._jrBottomAnchor : (parseFloat(p.style.top) || 0);
        hl.style.setProperty("--jr-anchor-name", name);
        hl.classList.add("jr-anchor-src");
        p.style.setProperty("--jr-anchor", name);
        p.style.setProperty("--jr-anchor-dy", dy + "px");
        p.style.setProperty("--jr-anchor-fb", (stays - dy) + "px");
        p.classList.add("jr-anchored");
        if (up) p.classList.add("jr-anchored-up");
        // (CSS takes an inline highlight's top a few px off from its client rect — live dom-test: 4 px — set to the place;
        // a bottom inset grows upward)
        var nr = p.getBoundingClientRect(), off = (want - (up ? nr.bottom : nr.top)) * (up ? -1 : 1);
        if (Math.abs(off) >= 0.5) {
          p.style.setProperty("--jr-anchor-dy", (dy + off) + "px");
          p.style.setProperty("--jr-anchor-fb", (stays - dy - off) + "px"); // (no anchor: still there)
        }
        p._jrAnchorHl = hl;
      });
    }
    /** Back to a plain top where it is now (the send's end, or its highlight gone). */
    function unanchor(p, keep) {
      if (!p._jrAnchorHl) return;
      if (p.isConnected) { // (same place: then the class goes)
        p.style.top = p.offsetTop + "px";
        if (p.classList.contains("jr-anchored-up")) p._jrBottomAnchor = p.offsetTop + p.offsetHeight;
      }
      p.classList.remove("jr-anchored", "jr-anchored-up");
      ["--jr-anchor", "--jr-anchor-dy", "--jr-anchor-fb"].forEach(function (v) { p.style.removeProperty(v); });
      var hl = p._jrAnchorHl;
      p._jrAnchorHl = null;
      if (hl && !openPopups().some(function (q) { return q._jrAnchorHl === hl; })) {
        hl.classList.remove("jr-anchor-src"); hl.style.removeProperty("--jr-anchor-name");
      }
      if (!keep) glued.delete(p); // (the glue takes it as it is from here)
    }
    // Each popup's place is kept to both the turn and the passage: the one the hold holds this frame is the one it goes by
    // (review: a passage not found for a frame — the turn drawn in parts — was taken for the turn, and a popup kept to
    // the passage moved by the passage's distance from the turn's top, thousands of px, and back)
    function glue(anchor) {
      var pops = openPopups(), resizing = document.documentElement.classList.contains("jr-resizing");
      var refs = { turn: anchorEl && anchorEl.isConnected ? anchorEl.getBoundingClientRect().top : null,
                   block: kind === "block" ? anchor.getBoundingClientRect().top : null };
      if (kind === "turn") refs.turn = anchor.getBoundingClientRect().top;
      function offs(pos) {
        return { turn: refs.turn === null ? null : pos - refs.turn, block: refs.block === null ? null : pos - refs.block };
      }
      pops.forEach(function (p) {
        if (!p || !p.isConnected || !p.parentElement) return;
        var untied = false;
        if (p._jrAnchorHl) { // tied by CSS: only its highlight must still be there (re-wrapped: the new one)
          // its place to the anchor while tied, for when the tie breaks (live B3, ChatGPT: the highlight's turn redrawn
          // while the list above was re-laid — untied, it fell back to its top from before the re-lay, 22 000 px off)
          if (p._jrAnchorHl.isConnected) {
            if (p._jrAnchorHl.getBoundingClientRect().height) { var tr = p.getBoundingClientRect(); glued.set(p, offs(p.classList.contains("jr-anchored-up") ? tr.bottom : tr.top)); }
            return;
          }
          var id = p._jrAnchorHl.getAttribute("data-jr-highlight-id"), now = id && document.querySelector('[data-jr-highlight-id="' + id + '"]');
          if (now && now.getBoundingClientRect().height) {
            now.style.setProperty("--jr-anchor-name", p.style.getPropertyValue("--jr-anchor"));
            now.classList.add("jr-anchor-src");
            p._jrAnchorHl = now;
            return;
          }
          unanchor(p, true);
          untied = true; // (its fallback top isn't a place, even while the user scrolls — review)
        }
        var r = p.getBoundingClientRect();
        if (!r.height) return; // (not drawn: being measured)
        var above = p._jrLockedDirection === "above" && p._jrBottomAnchor != null, top = parseFloat(p.style.top) || 0;
        // an "above" one by the bottom it is placed to, not as drawn (live: measured the moment Return made it taller,
        // before its top followed, it was held 50 px low, over its highlight, for the whole send)
        var pos = above ? r.top - top + p._jrBottomAnchor : r.top;
        var g = glued.get(p);
        // (the user scrolling — the chat or inside a parent popup, where a nested one follows its highlight — or
        // dragging an edge places it: taken as it is)
        if (!g || g[kind] === null || resizing || (userScrolling && !untied)) {
          var o = offs(pos);
          if (!g || g[kind] === null || Math.abs(o[kind] - g[kind]) >= 0.5) JR.posLog("glue-base", p, { at: !g ? "first" : resizing ? "resizing" : "user", off: Math.round(o[kind]), above: above });
          glued.set(p, o); return;
        }
        var d = pos - refs[kind] - g[kind];
        if (Math.abs(d) >= 0.5) {
          if (above) p._jrBottomAnchor -= d;
          p.style.top = (top - d) + "px";
          JR.posLog("glue", p, { d: Math.round(d) });
        }
        glued.set(p, offs(pos - d)); // (the other one's place taken anew: it goes by it when this one isn't found)
      });
    }
    var savedTop = container.scrollTop;
    // the list as the send began: if the reader's turn isn't mounted after the site re-laid it bigger (earlier turns
    // loaded above), its place is where it was plus what came above (live Beta 11-20: the list collapsed, came back
    // 14 000 px taller, the hold went to the site's own place — an article far above)
    var startTop = container.scrollTop, startH = container.scrollHeight, lastH = startH;
    pickPoint(anchorEl, hint);
    takePlaces(anchorEl && anchorEl.isConnected ? anchorEl : null);
    // now, while everything is where the reader sees it: the anchor marked and the popups' places to it (live N1d: taken
    // at the anchor's first sight later — its turn a placeholder in the list ChatGPT had collapsed — a popup went 2658 px off)
    var startAnchor = liveAnchor();
    if (withPopups) anchorPopups();
    // the window resized during the send: placing is the placer's again (its highlight may wrap otherwise — an anchored
    // popup kept its old offset and covered the highlight's last line — ponytail review)
    function onResize() { if (withPopups) openPopups().forEach(function (p) { unanchor(p); }); }
    window.addEventListener("resize", onResize);
    if (startAnchor && withPopups) glue(startAnchor);
    var userScrolling = false;
    var wheelTimer = null;
    var rafId = null;
    // After a send ChatGPT's virtual list re-measures the turns (T18: heights above the reader swap to estimates
    // and back). A ResizeObserver runs after layout and before paint, so a correction made there is never
    // drawn in the wrong place; the frame loop is only the fallback (R33).
    var ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(function () { correct(); }) : null;
    var observed = [];
    function observe(els) {
      if (!ro || (els[0] === observed[0] && els[1] === observed[1])) return;
      ro.disconnect();
      observed = els;
      els.forEach(function (el) { if (el) ro.observe(el); });
    }

    function markUser(e) {
      if (e._jrPressed) return; // (a site control pressed for a popup: site-control.js — press.js "synthetic")
      // Typing or clicking in Popup's UI (Return, the send arrow in a popup) isn't scrolling the chat (R33)
      if ((e.type === "keydown" || e.type === "pointerdown") && !/^(outside|repeat|scrollbar)$/.test(JR.press.of(e).owner)) return;
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

    // The reader's turn gone from the list and the list settled without it (live NT2 G2, 4 runs, ChatGPT: at the send
    // it rebuilt its list — 75 196 → 50 945 px, the reader's 19 500 px turn back to an estimate — and scrolled to
    // 45 221, past it; no estimate from heights can know where it went): reached again by its key, as ∧ does, then
    // held where the reader saw it (its drift, below). Once per send.
    var pickedAt = 0, moved = false, lostAt = 0, settledH = -1, settledAt = 0, reaching = false, reaches = 0, reachFailed = false, jumped = false, unlocked = false;
    var seenJump = JR.jumpState ? JR.jumpState().seq : 0;
    function reachBack(now) {
      if (jumped) return false; // (the reader jumped elsewhere during the send: not pulled back to where they were)
      if (!lostAt) lostAt = now;
      if (container.scrollHeight !== settledH) { settledH = container.scrollHeight; settledAt = now; }
      // (up to 3, each once the list held still 600 ms — live NT12 G2: reached, then ChatGPT measured the 21 000 px turns
      // above it and its own scroll was 6 000 px off: pushed out again; the search no longer steps on a list being
      // rebuilt, reach-turn.js. None after one that didn't find it)
      if (reaches >= 3 || reachFailed || now - lostAt < 600 || now - settledAt < 600 || !JR.scrollToTurnKey) return false;
      reaching = true; reaches++;
      JR.posLog("reach-back", document.documentElement, { key: String(anchorKey).slice(0, 8), top: Math.round(container.scrollTop) });
      var from = savedTop;
      // (not found, or stopped — the user scrolling, the hold's end, Esc: back where it started, no second search —
      // review: it held the reader where the search stopped, the top of a long chat)
      JR.scrollToTurnKey(anchorKey, function (ok) {
        reaching = false; lostAt = 0;
        if (!ok) reachFailed = true;
        if (unlocked) return;
        if (!ok && !userScrolling) container.scrollTop = from;
        savedTop = container.scrollTop;
      }, function () { return unlocked || userScrolling; });
      return true;
    }

    var nCorrect = 0;
    function correct() {
      var chainY;
      if (reaching) return; // (its search scrolls the list: not held against it)
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
      observe([container.firstElementChild, anchor]); // the content (any height change) and the anchor turn
      // (a jump of the user's: while it scrolls, once after it ended, and while its settle holds the chat —
      // popup-helpers.js; the settle itself takes none. Review: a send's hold and a jump's settle both held the chat,
      // and the send's glue put the jump's popup back where it was)
      var js = JR.jumpState && JR.jumpState(), jumping = !!js && (js.on || js.seq !== seenJump || (withPopups && js.settling));
      if (js) seenJump = js.seq;
      if (anchor && withPopups && !jumping) glue(anchor);
      var site = html.getAttribute("data-jr-site-scroll");
      if (site !== siteScroll) { siteScroll = site; savedTop = container.scrollTop; }
      if (userScrolling || jumping) { // (the user scrolling, or a jump of theirs: popup-helpers.js)
        if (jumping) jumped = true;
        savedTop = container.scrollTop;
        // (where the user went is the new start: a later height change estimates from there, not the send's start —
        // review: a reader who scrolled away was thrown back)
        startTop = container.scrollTop; startH = lastH = container.scrollHeight;
        // Scrolled out of ChatGPT's list (unmounted): no old position to go back to when it remounts; the passage now
        // in view is the one to hold — after a jump, in the turn it went to (its popup's highlight)
        var now = Date.now();
        moved = jumping ? "jump" : "user";
        if (now - pickedAt >= 100) { // (not every frame: every block of a 20 000 px turn measured — review)
          pickedAt = now;
          if (jumping) {
            var v = JR.viewAnchor(), vt = v && JR.site.turnOf(v);
            if (vt) { anchorEl = vt; anchorKey = JR.getTurnKey(vt) || anchorKey; glued.clear(); }
          }
          var t0 = anchorEl && anchorEl.isConnected ? anchorEl : null;
          pickPoint(t0, jumping ? JR.viewAnchor() : null);
          takePlaces(t0);
        }
      } else {
        // (the first look after it: the passage where the move ended — the last pick may be up to 100 ms older)
        if (moved) {
          var tm = anchorEl && anchorEl.isConnected ? anchorEl : null;
          pickPoint(tm, moved === "jump" ? JR.viewAnchor() : null); takePlaces(tm); anchor = liveAnchor();
          moved = false;
        }
        if (anchor) { lostAt = 0; learnChain(); }
        else if (anchorKey && saved.turn !== null && (chainY = placeFromChain()) !== null && Math.abs(chainY - saved.turn) > 1) {
          JR.posLog("lock-chain", document.documentElement, { d: Math.round(chainY - saved.turn), top: Math.round(container.scrollTop) });
          container.scrollTop += chainY - saved.turn; // (there it is drawn again; then held as before)
          return;
        }
        else if (anchorKey && (saved.turn !== null || saved.block !== null) && reachBack(Date.now())) return;
        if (anchor && saved[kind] === null) {
          saved[kind] = anchor.getBoundingClientRect().top;
        } else if (anchor) {
          // The anchor turn stays where it is on screen in every drawn frame — even while ChatGPT draws it
          // as a placeholder: what the reader looks at doesn't move.
          var currentY = anchor.getBoundingClientRect().top;
          var drift = currentY - saved[kind];
          if (Math.abs(drift) > 1) {
            if (Math.abs(drift) > 40) JR.posLog("lock", st.activePopup || document.documentElement, { drift: Math.round(drift), top: Math.round(container.scrollTop) });
            // savedTop stays where the user was: ChatGPT re-creates every turn after a send, and a correction made
            // in that collapsed list is fake; when the anchor turn is gone we go back to savedTop (R33, T14)
            container.scrollTop += drift;
          }
          // (the turn's place taken anew where the passage is held: the turn is what is held when the passage isn't
          // found for a frame — review: held at its place from the start, the chat jumped by the inner re-layout)
          if (kind === "block" && anchorEl && anchorEl.isConnected) saved.turn = anchorEl.getBoundingClientRect().top;
        } else if (container.scrollHeight > container.clientHeight * 3 && container.scrollHeight !== lastH && container.scrollHeight !== startH &&
                   Math.abs(container.scrollTop - savedTop) > 1) {
          // (only when the place moved — the site scrolled, or the end came above it: a list growing below the reader,
          // the answer streaming, moved nothing — review: the estimate pushed them down by what came below)
          // (taller: earlier turns came above — live Beta C2; shorter: the site dropped earlier turns above when the
          // send went out — live NT2 G2, the old place lay past the new end and the hold left the reader at the bottom)
          lastH = container.scrollHeight; // (once per height: there it mounts, and the anchor's own drift takes over)
          var est = startTop + (container.scrollHeight - startH);
          if (Math.abs(container.scrollTop - est) > container.clientHeight) { container.scrollTop = est; savedTop = est; }
        } else if (container.scrollTop !== savedTop) {
          container.scrollTop = savedTop;
        }
      }
    }
    function frame() { correct(); rafId = requestAnimationFrame(frame); }
    rafId = requestAnimationFrame(frame);

    addListeners(container);

    return function unlock() {
      unlocked = true;
      window.removeEventListener("resize", onResize);
      // (a settle's end unties none: they are the send's — review)
      if (withPopups) openPopups().concat(Array.prototype.slice.call(document.querySelectorAll(".jr-popup.jr-anchored"))).forEach(function (p) { unanchor(p); });
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
    if (r.stage === "rejected") return JR.site.label + " was still answering and didn\u2019t take the question \u2014 nothing was sent";
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
    var timerId = null;
    var qaKeys = [];          // keys of the turn(s) holding our Q&A (1 in the new DOM, 2 in the legacy DOM)
    var responseTurn = null;  // element holding the answer (re-found by key if ChatGPT remounts it)
    var responseKey = null;
    var detached = false;
    var detachedSpans = null;
    var detachedHlId = editOpts ? editOpts.hlId : null;
    var linkItemId = preRegisteredItemId || (editOpts && editOpts.itemId) || null; // (the version stored when sent: its turns linked as they come)
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
          addDeletedTurns(convUrl, [d.turnKey], linkItemId ? { id: linkItemId, turnKeys: qaKeys.slice() } : null);
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
      return JR.locator.answered(t) && !!JR.site.assistantText(t).trim(); // (its text is read from the page)
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
        // Edit: its version (stored when sent) failed
        var newItemId = editOpts.itemId || crypto.randomUUID();
        putVersion(memEntry, { id: newItemId, question: question, status: "failed", turnKeys: hideKeys,
          _files: memEntry._editFiles, _failedFiles: memEntry._editFailed, attachments: (memEntry._editFiles || []).length });
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
      if (linkItemId) JR.availability.on(linkItemId, { t: "failed", reason: "no-answer" });
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

      // the reader's place stays held till the send ends (cleanup): closed while it waited for the site (the site busy
      // with the main answer — sent again when idle), the send came later with nothing held and the chat jumped
      // (live NT2 G2, both Chromes) — until the user does something (a jump, a click, a key): then it is theirs (review:
      // ∧ ∨, the keyboard, a scrollbar drag were pulled back for the rest of the send)
      if (!editOpts) detachedHlId = preRegisteredHlId; // (every send pre-registers its version: popup.js doSend / Retry — A1b)
      if (unlockScroll) {
        var held = unlockScroll;
        var letGo = function (e) {
          if (!e.isTrusted || e.key === "Escape" || (e.target.closest && e.target.closest(".jr-popup"))) return;
          window.removeEventListener("pointerdown", letGo, true); window.removeEventListener("keydown", letGo, true);
          if (unlockScroll === held) { unlockScroll = null; held(); }
        };
        window.addEventListener("pointerdown", letGo, true); window.addEventListener("keydown", letGo, true);
      }
      // Keep observer running — streaming continues in background
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
      if (linkItemId) JR.availability.on(linkItemId, { t: "done" });
      var spans = detached ? detachedSpans : st.activeSourceHighlights;

      var turn = liveResponseTurn();
      // the answer's text, for ordering highlights in it only (the popup shows the site answer from its original)
      var answerText = domAnswerUsable() ? JR.site.assistantText(turn).trim()
        : mirrorDiv ? mirrorDiv.textContent.trim() : ""; // (the hidden turn is gone: what the popup showed of it, R36f)
      if (JR.sendOutcome.settle({ answerText: answerText, turn: turn ? { answered: JR.locator.answered(turn) } : null,
          net: { text: net.text.trim(), media: !!net.media } }) === "empty") {
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
        var newItemId = editOpts.itemId || crypto.randomUUID(); // (stored when sent: replaced)
        if (memEntry) {
          putVersion(memEntry, { id: newItemId, question: question, status: "done", turnKeys: qaKeys.slice(),
            _files: memEntry._editFiles, _failedFiles: memEntry._editFailed, attachments: (memEntry._editFiles || []).length });
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

        // Only claim active highlight if the popup is still showing this highlight — and is the active one (a child opened
        // from the streaming answer stays active: review #8)
        if (editPopupOpen && (detached || popup === st.activePopup)) {
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

      function fillItem(e, itemId) {
        e.question = e.question || question || null;
        if (!e.sourceTurnKey) e.sourceTurnKey = sourceTurnKey;
        // (its version by id only: every send stores it first — A1b; no other version taken for it — review)
        var it = (e.items || []).filter(function (x) { return x.id === itemId; })[0];
        if (it) { it.status = "done"; it.turnKeys = qaKeys.slice(); }
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
      } else {
        // the version stored when sent (every send pre-registers it — A1b: no other kind)
        hlId2 = preRegisteredHlId;
        entry = st.completedHighlights.get(hlId2);
        if (entry) fillItem(entry, preRegisteredItemId);
        // Rebuild popup into completed view (editable question, version nav)
        if (popup && popup.isConnected) {
          if (popup === st.activePopup) { st.activeHighlightId = hlId2; JR.syncHighlightActive(hlId2); } // (review #8)
          JR.rebuildPopupAfterEdit(popup, hlId2);
        }
      }

      updateHighlightFields(preRegisteredItemId, {
        status: "done",
        turnKeys: qaKeys,
        sourceTurnKey: (entry && entry.sourceTurnKey) || sourceTurnKey,
      }, convUrl);

      JR.updateNavWidget();
      st.cancelResponseWatch = null;
      JR.drainQueue();
    }

    var lastContentSnapshot = "";
    var lastNetLength = 0;
    var lastProgress = Date.now();     // last time the answer grew (DOM or network)
    var told = {}; // when the answer's growth was last told to its availability
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
          addDeletedTurns(convUrl, added, linkItemId ? { id: linkItemId, turnKeys: qaKeys.slice() } : null);
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

      // Progress: the answer grew in the DOM or in the network stream.
      var currentContent = turn ? JR.site.assistantText(turn) : "";
      if (currentContent !== lastContentSnapshot || net.text.length !== lastNetLength) {
        lastContentSnapshot = currentContent;
        lastNetLength = net.text.length;
        // (its availability: the deadline moves on as it grows — told at most every 5 s)
        if (linkItemId && Date.now() - (told.progress || 0) > 5000) { told.progress = Date.now(); JR.availability.on(linkItemId, { t: "progress" }); }
        lastProgress = Date.now();
      }

      // 2. What now: one place decides (send-outcome.js); here only what is known, and the decision carried out
      var checkBox = !qaKeys.length && !net.matched && !rejected.pending && !submitting && Date.now() - startTime >= JR.sendOutcome.LIMITS.refusal;
      var composer = checkBox ? JR.site.composer() : null, probe = norm60(message).slice(0, 30);
      var d = JR.sendOutcome.decide({
        now: Date.now(), start: startTime, lastProgress: lastProgress, generating: generating,
        keys: qaKeys.length, responseKey: !!responseKey,
        turn: turn ? { text: !!currentContent.trim(), answered: JR.locator.answered(turn) } : null,
        domUsable: net.done ? domAnswerUsable() : true, submitting: submitting, // (read only when the stream is done)
        composerHasOurs: !!(composer && probe && norm60(JR.site.composerText(composer)).indexOf(probe) !== -1),
        canResend: !(files && files.length) && !lastHadAside, rejected: rejected,
        net: { matched: net.matched, done: net.done, text: !!net.text.trim(), media: !!net.media, resuming: net.resuming || 0 },
        resume: resumeLook,
      });
      if (d.report && (!st.lastSendReport || st.lastSendReport.ok)) {
        st.lastSendReport = { ok: false, stage: d.report, detail: "the site is answering but the new turn is not on the page", when: new Date().toISOString() };
      }
      if (d.readResume) { // (the send's stream ended before the answer — a thinking model resumes it elsewhere, live 11-20)
        resumeLook.busy = true; resumeLook.n++;
        JR.qa.answerFor(message).then(function (a) {
          resumeLook.busy = false;
          if (!a) { net.resuming = Date.now() + 1500; return; }
          onNet({ detail: JSON.stringify({ kind: "turn", turnKey: a.turnKey }) });
          net.text = a.text; net.media = a.media; net.done = true;
        }, function () { resumeLook.busy = false; });
      }
      if (d.act === "capture") { setTimeout(captureResponse, 300); return; }
      if (d.act === "fail" || d.act === "stop-fail") {
        // the site refused it (busy) and put it back in its box: out of the box at once (never seen), files handed back
        if (d.stage === "rejected") {
          clearComposer(composer, files); putDraftBack(composer, lastDraft); handBackFiles();
          st.lastSendReport = { ok: false, stage: "rejected", detail: JR.site.label + " refused the message", when: new Date().toISOString() };
        }
        if (d.act === "stop-fail") stopGeneration();
        finishWithTimeout();
        return;
      }
      if (d.act === "resend") {
        clearComposer(composer, files);
        putDraftBack(composer, lastDraft); // (the user's own text came back to the box with it)
        handBackFiles();
        rejected.count++;
        rejected.pending = true;
        st.lastSendReport = { ok: false, stage: "retrying", detail: JR.site.label + " was still busy; will resend", when: new Date().toISOString() };
        (function resendWhenIdle(tries) {
          if (JR.isGenerating() && tries < 120) { setTimeout(function () { resendWhenIdle(tries + 1); }, 500); return; }
          snap = JR.snapshotTurns();
          startTime = Date.now();
          rejected.pending = false;
          JR.injectAndSend(message, function (r) { if (!r.ok) watch.failInjection(r); });
        })(0);
      }
      if (rejected.pending) { timerId = setTimeout(poll, 300); return; }

      // Poll fast initially to catch new turns quickly, then slow down
      var interval = responseKey ? 500 : 80;
      timerId = setTimeout(poll, interval);
    }

    timerId = setTimeout(poll, 80);

    var watch = {
      /** The injection itself failed: stop watching, undo, and say why in the popup. */
      failInjection: function () {
        injectionFailed = true;
        if (linkItemId) JR.availability.on(linkItemId, { t: "failed", reason: "not-sent" });
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

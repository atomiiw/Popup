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

  /** Remove text from ChatGPT's composer (used when ChatGPT refused our send). */
  function clearComposer(composer) {
    if (!composer) return;
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
    var mo = new MutationObserver(function () {
      if (JR.perf) JR.perf.count("freezeObserver");
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
    _freeze = { mo: mo, keys: [] };
  };

  /** Stop freezing. Returns the keys the freeze hid (the caller unhides them if the send is abandoned). */
  JR.unfreezeChat = function () {
    if (!_freeze) return [];
    _freeze.mo.disconnect();
    var keys = _freeze.keys;
    _freeze = null;
    return keys;
  };

  // --- Chat injection ---

  /** Insert text into ChatGPT's composer. Returns true if the text is verifiably there. */
  function insertIntoComposer(composer, message) {
    var probe = message.replace(/\s+/g, " ").slice(0, 30);
    function landed() {
      return JR.site.composerText(composer).replace(/\s+/g, " ").indexOf(probe) !== -1;
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
    composer.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    return landed();
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
      onDone(report(false, "composer", "ChatGPT's input box was not found"));
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
      "\n:has(> [data-jr-injecting]) { max-height: " + composerH + "px !important; overflow: hidden !important; }";
    document.head.appendChild(hideStyle);
    function unhideComposer() {
      hideStyle.remove();
      chatInput.removeAttribute("data-jr-injecting");
    }

    chatInput.focus({ preventScroll: true });
    var inserted = insertIntoComposer(chatInput, message);
    if (scrollParent) scrollParent.scrollTop = savedScrollTop;
    if (!inserted) {
      unhideComposer();
      onDone(report(false, "insert", "the text did not appear in ChatGPT's input box"));
      return;
    }

    var probe = message.replace(/\s+/g, " ").slice(0, 30);
    function afterSubmit(how) {
      chatInput.blur();
      if (scrollParent) scrollParent.scrollTop = savedScrollTop;
      // Keep the text hidden until React has actually cleared the input.
      var tries = 0;
      (function removeHideWhenEmpty() {
        var left = JR.site.composerText(chatInput);
        if (left.trim().length === 0 || tries > 20) {
          unhideComposer();
          var stuck = left.replace(/\s+/g, " ").indexOf(probe) !== -1;
          onDone(stuck ? report(false, "submit", "the message stayed in the input after " + how)
                       : report(true, "sent", how));
          return;
        }
        tries++;
        requestAnimationFrame(removeHideWhenEmpty);
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
    requestAnimationFrame(trySend);
  };

  /**
   * Shared beforeSend step for every send path: snapshot the turns (to spot the
   * new one) and keep the user's scroll position while ChatGPT answers.
   */
  JR.prepareSend = function (w, anchorEl) {
    // Freeze here, when the message is really sent (not when it was queued).
    JR.freezeChat();
    w.turnsBefore = JR.snapshotTurns();
    var scroller = JR.site.scrollContainer();
    var anchor = anchorEl && anchorEl.isConnected ? anchorEl : null;
    var unlock = scroller ? JR.lockScroll(scroller, anchor) : null;
    // Page-world guard (scroll-guard.js): ChatGPT's own scroll-to-new-turn is ignored while set.
    document.documentElement.setAttribute("data-jr-scroll-lock", String(Date.now()));
    JR.setTailHidden(true);
    w.unlockScroll = function () {
      document.documentElement.removeAttribute("data-jr-scroll-lock");
      if (unlock) unlock();
    };
  };

  // --- Message queue ---
  // When ChatGPT is generating, new popup sends are queued and dispatched
  // one-by-one as each generation completes.

  /**
   * Enqueue a message to be sent. If idle, sends immediately.
   * @param {object} opts
   * @param {string} opts.message - The injection message
   * @param {object} opts.waitOpts - Args for JR.waitForResponse (popup, text, sentence, blockTypes, parentId, question, editOpts, ...)
   * @param {function} [opts.beforeSend] - Called right before injection; should call JR.prepareSend(w, anchor).
   */
  JR.enqueueMessage = function (opts) {
    if (!opts.force && (JR.isGenerating() || st.responseWatchActive)) {
      st.messageQueue.push(opts);
      return;
    }
    sendQueued(opts);
  };

  function sendQueued(opts) {
    var w = opts.waitOpts;
    if (opts.beforeSend) opts.beforeSend(w);
    if (!w.turnsBefore || !w.turnsBefore.keys) w.turnsBefore = JR.snapshotTurns();

    // Offline check: skip injection entirely, save __TIMEOUT__ immediately
    if (!navigator.onLine) {
      report(false, "offline", "the browser is offline");
      immediateTimeout(w);
      JR.drainQueue();
      return;
    }

    var watch = JR.waitForResponse(w.popup, w.turnsBefore, w.text, w.sentence, w.blockTypes, w.unlockScroll,
      w.parentId, w.question, w.editOpts, w.preRegisteredHlId, w.preRegisteredItemId, opts.message,
      w.wholeResponse, w.wholeResponseFull);
    JR.injectAndSend(opts.message, function (r) {
      if (!r.ok && watch) watch.failInjection(r);
    });
  }

  /**
   * Immediately save __TIMEOUT__ for a message that was never sent (e.g. offline).
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
      memEntry.items.push({ id: newItemId, question: w.question, responseHTML: "__TIMEOUT__", turnKeys: [] });
      memEntry.activeItemIndex = memEntry.items.length - 1;
      memEntry.question = w.question;
      memEntry.responseHTML = "__TIMEOUT__";
      saveHighlight({
        id: newItemId, quoteId: hlId, text: memEntry.text, responseHTML: "__TIMEOUT__",
        url: location.href, parentId: memEntry.parentId || null, parentItemId: memEntry.parentItemId || null,
        sourceTurnKey: memEntry.sourceTurnKey || null, turnKeys: [], active: true,
        wholeResponse: !!memEntry.wholeResponse,
      });
    } else {
      var itemIdx = memEntry.activeItemIndex || 0;
      if (memEntry.items && memEntry.items[itemIdx]) {
        memEntry.items[itemIdx].responseHTML = "__TIMEOUT__";
      }
      memEntry.responseHTML = "__TIMEOUT__";
      var updateId = w.preRegisteredItemId || (memEntry.items && memEntry.items[itemIdx] ? memEntry.items[itemIdx].id : null);
      if (updateId) {
        updateHighlightFields(updateId, { responseHTML: "__TIMEOUT__" });
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
    if (JR.isGenerating()) return;
    var next = st.messageQueue.shift();
    sendQueued(next);
  };

  // Fallback poller: if messages are queued but no responseWatch is active
  // (e.g. user sent a question via ChatGPT's own input), poll until idle
  // then drain.
  setInterval(function () {
    if (st.messageQueue.length === 0) return;
    if (st.responseWatchActive) return;
    if (JR.isGenerating()) return;
    JR.drainQueue();
  }, 300);

  // --- Response capture ---

  /** Copy a turn's assistant answer (all markdown roots) into a popup's response div. */
  // --- Incremental streaming mirror ---
  // Copying the whole answer every frame recreated every word, which restarted
  // ChatGPT's per-word fade-in and made text appear in jumps. Instead, patch the
  // popup copy in place: existing nodes are kept (text updated, attributes
  // synced) and only new nodes are cloned in, so each new word animates once.

  function sameKind(a, b) {
    return a.nodeType === b.nodeType && (a.nodeType !== 1 || a.tagName === b.tagName);
  }

  function syncAttrs(src, dst) {
    var i, a;
    for (i = dst.attributes.length - 1; i >= 0; i--) {
      a = dst.attributes[i].name;
      if (!src.hasAttribute(a)) dst.removeAttribute(a);
    }
    for (i = 0; i < src.attributes.length; i++) {
      a = src.attributes[i];
      if (dst.getAttribute(a.name) !== a.value) dst.setAttribute(a.name, a.value);
    }
  }

  /** Make dstParent's children mirror srcNodes (an array), reusing matching nodes. */
  function syncChildren(srcNodes, dstParent) {
    var d = dstParent.firstChild;
    for (var i = 0; i < srcNodes.length; i++) {
      var s = srcNodes[i];
      if (d && sameKind(s, d)) {
        if (s.nodeType === 3 || s.nodeType === 8) {
          if (d.data !== s.data) d.data = s.data;
        } else if (s.nodeType === 1) {
          syncAttrs(s, d);
          syncChildren(Array.prototype.slice.call(s.childNodes), d);
        }
        d = d.nextSibling;
      } else {
        dstParent.insertBefore(s.cloneNode(true), d);
      }
    }
    while (d) {
      var next = d.nextSibling;
      dstParent.removeChild(d);
      d = next;
    }
  }

  /** Mirror a turn's answer (all markdown roots) into responseDiv incrementally. */
  function syncAnswerInto(responseDiv, turn) {
    var bodies = JR.site.assistantBodies(turn);
    if (!bodies.length) return false;
    var src = [];
    for (var i = 0; i < bodies.length; i++) src = src.concat(Array.prototype.slice.call(bodies[i].childNodes));
    syncChildren(src, responseDiv);
    return true;
  }

  function cloneAnswerInto(responseDiv, turn) {
    var bodies = JR.site.assistantBodies(turn);
    if (!bodies.length) return false;
    var nodes = [];
    for (var i = 0; i < bodies.length; i++) {
      var c = bodies[i].cloneNode(true);
      while (c.firstChild) nodes.push(c.removeChild(c.firstChild));
    }
    responseDiv.replaceChildren.apply(responseDiv, nodes);
    return true;
  }

  /**
   * Display the AI response content inside the popup.
   * Reuses an existing .jr-popup-response div if streaming already created one.
   */
  JR.showResponseInPopup = function (popup, responseTurn) {
    var loading = popup.querySelector(".jr-popup-loading");
    if (loading) loading.remove();

    var responseDiv = popup.querySelector(".jr-popup-response");
    if (!responseDiv) {
      responseDiv = document.createElement("div");
      responseDiv.className = "jr-popup-response";
      popup.appendChild(responseDiv);
    }
    cloneAnswerInto(responseDiv, responseTurn);
    if (JR.wireResponseClicks) JR.wireResponseClicks(responseDiv);
    if (JR.processResponseLinks) JR.processResponseLinks(responseDiv);
    if (JR.processResponseImages) JR.processResponseImages(responseDiv); // [CAROUSEL-LOCKED]
    JR.wireCopyButtons(responseDiv);  // rebuildCodeBlocks
  };

  /**
   * Block programmatic auto-scrolling on a container. Returns an unlock function.
   */
  JR.lockScroll = function (container, anchorEl) {
    // Anchor on the anchor's turn (by key): ChatGPT rebuilds turn DOM while the
    // virtual list re-measures, which detaches the original element.
    var anchorKey = anchorEl ? JR.getTurnKey(anchorEl) : null;
    if (anchorKey) anchorEl = JR.site.findTurnByKey(anchorKey) || anchorEl;
    function liveAnchor() {
      if (anchorEl && anchorEl.isConnected) return anchorEl;
      if (anchorKey) anchorEl = JR.site.findTurnByKey(anchorKey);
      return anchorEl && anchorEl.isConnected ? anchorEl : null;
    }
    var savedTop = container.scrollTop;
    var savedAnchorY = anchorEl ? anchorEl.getBoundingClientRect().top : null;
    var userScrolling = false;
    var wheelTimer = null;
    var rafId = null;

    function markUser() {
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

    function enforce() {
      if (!container.isConnected) {
        var fresh = JR.site.scrollContainer();
        if (!fresh) return;
        removeListeners(container);
        container.scrollTo = origScrollTo;
        container.scrollBy = origScrollBy;
        container = fresh;
        savedTop = container.scrollTop;
        origScrollTo = container.scrollTo;
        origScrollBy = container.scrollBy;
        patchScroll();
        addListeners(container);
      }

      var anchor = liveAnchor();
      if (userScrolling) {
        savedTop = container.scrollTop;
        if (anchor) {
          savedAnchorY = anchor.getBoundingClientRect().top;
        }
      } else {
        if (anchor && savedAnchorY !== null) {
          var currentY = anchor.getBoundingClientRect().top;
          var drift = currentY - savedAnchorY;
          if (Math.abs(drift) > 1) {
            container.scrollTop += drift;
            savedTop = container.scrollTop;
          }
        } else if (container.scrollTop !== savedTop) {
          container.scrollTop = savedTop;
        }
      }
      rafId = requestAnimationFrame(enforce);
    }
    rafId = requestAnimationFrame(enforce);

    var origScrollTo = container.scrollTo;
    var origScrollBy = container.scrollBy;
    function patchScroll() {
      container.scrollTo = function () {
        if (userScrolling) {
          origScrollTo.apply(container, arguments);
          savedTop = container.scrollTop;
        }
      };
      container.scrollBy = function () {
        if (userScrolling) {
          origScrollBy.apply(container, arguments);
          savedTop = container.scrollTop;
        }
      };
    }
    patchScroll();
    addListeners(container);

    return function unlock() {
      if (rafId) cancelAnimationFrame(rafId);
      removeListeners(container);
      container.scrollTo = origScrollTo;
      container.scrollBy = origScrollBy;
      if (wheelTimer) clearTimeout(wheelTimer);
    };
  };

  /** User-facing reason for a failed send, from the last injection report. */
  var failureText = JR.sendFailureText = function () {
    var r = st.lastSendReport;
    if (!r || r.ok) return "Couldn’t get a response";
    if (r.stage === "composer") return "Popup couldn’t find ChatGPT’s input box — nothing was sent";
    if (r.stage === "insert") return "Popup couldn’t type into ChatGPT’s input box — nothing was sent";
    if (r.stage === "submit") return "Popup couldn’t press Send — nothing was sent";
    if (r.stage === "offline") return "You’re offline — nothing was sent";
    if (r.stage === "turn-not-found") return "ChatGPT answered, but Popup couldn’t find the answer on the page";
    return "Couldn’t get a response";
  };

  /**
   * Watch for the Q&A turn created by our send, hide it, stream the answer
   * into the popup and save the result. Returns { failInjection(report) }.
   * @param {object} snap - JR.snapshotTurns() taken right before sending
   * @param {string} message - the exact injected message (used to recognise the new turn)
   */
  JR.waitForResponse = function (popup, snap, text, sentence, blockTypes, unlockScroll, parentId, question, editOpts, preRegisteredHlId, preRegisteredItemId, message, wholeResponse, wholeResponseFull) {
    // Resolve the parent's active item id at call time (for parentItemId tracking)
    var parentItemId = null;
    if (parentId) {
      var parentEntry = st.completedHighlights.get(parentId);
      if (parentEntry && parentEntry.items && parentEntry.items.length > 0) {
        var pidx = parentEntry.activeItemIndex != null ? parentEntry.activeItemIndex : 0;
        parentItemId = parentEntry.items[pidx] ? parentEntry.items[pidx].id : null;
      }
    }
    st.responseWatchActive = true;
    var convUrl = location.href; // storage writes go to this conversation even if the user navigates away
    var startTime = Date.now();
    var timeoutMs = 100000; // 100 seconds
    var timerId = null;
    var qaKeys = [];          // keys of the turn(s) holding our Q&A (1 in the new DOM, 2 in the legacy DOM)
    var responseTurn = null;  // element holding the answer (re-found by key if ChatGPT remounts it)
    var responseKey = null;
    var cancelled = false;
    var detached = false;
    var detachedSpans = null;
    var detachedHlId = editOpts ? editOpts.hlId : null;
    var streamObserver = null;
    var streamRafId = null;
    var streamDirty = false;
    var injectionFailed = false;

    // Answer text from ChatGPT's network stream (net-tap.js, MAIN world). Used
    // when the answer's turn isn't in the DOM (virtualized away) or ChatGPT
    // failed to render it; ChatGPT's own DOM rendering is preferred otherwise.
    var net = { matched: false, text: "", done: false };
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
          JR.hideTurnKeys([d.turnKey]);
          addDeletedTurns(convUrl, [d.turnKey]);
          if (!editOpts && preRegisteredItemId) updateHighlightFields(preRegisteredItemId, { turnKeys: qaKeys.slice() }, convUrl);
        }
        return;
      }
      net.text = d.text || net.text;
      if (d.kind === "done") net.done = true;
      if (!domAnswerUsable()) renderNetText();
    }
    document.addEventListener("jr-net", onNet);

    /** ChatGPT's DOM has a usable answer for our turn right now. */
    function domAnswerUsable() {
      var t = liveResponseTurn();
      return !!(t && !JR.site.renderFailed(t) && JR.site.assistantText(t).trim());
    }

    function renderNetText() {
      var targetPopup = getStreamTarget();
      if (!targetPopup || !net.text) return;
      var responseDiv = targetPopup.querySelector(".jr-popup-response");
      if (!responseDiv) {
        var loadingEl = targetPopup.querySelector(".jr-popup-loading");
        if (loadingEl) loadingEl.remove();
        responseDiv = document.createElement("div");
        responseDiv.className = "jr-popup-response";
        targetPopup.appendChild(responseDiv);
        JR.repositionPopup();
      }
      var tmp = document.createElement("div");
      tmp.innerHTML = JR.renderMarkdown(net.text);
      syncChildren(Array.prototype.slice.call(tmp.childNodes), responseDiv);
      targetPopup.classList.add("jr-popup--streaming");
      if (JR.wireResponseClicks) JR.wireResponseClicks(responseDiv);
      JR.checkStreamingOverflow();
      if (targetPopup._jrLockedDirection === "above") JR.repositionPopup();
    }

    function unhideTurns() {
      JR.unhideTurnKeys(qaKeys);
    }

    function showTimeoutUI(targetPopup) {
      if (!targetPopup || !targetPopup.isConnected) return;
      var streamDiv = targetPopup.querySelector(".jr-popup-response");
      if (streamDiv) streamDiv.remove();
      var existingLoading = targetPopup.querySelector(".jr-popup-loading");
      if (existingLoading) existingLoading.remove();

      var timeoutDiv = document.createElement("div");
      timeoutDiv.className = "jr-popup-loading";

      var msg = document.createElement("div");
      msg.textContent = failureText();
      timeoutDiv.appendChild(msg);

      var retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.className = "jr-retry-btn";
      retryBtn.title = "Try again";
      retryBtn.innerHTML = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M244,56v48a12,12,0,0,1-12,12H184a12,12,0,1,1,0-24H201.1l-19-17.38c-.13-.12-.26-.24-.38-.37A76,76,0,1,0,127,204h1a75.53,75.53,0,0,0,52.15-20.72,12,12,0,0,1,16.49,17.45A99.45,99.45,0,0,1,128,228h-1.37A100,100,0,1,1,198.51,57.06L220,76.72V56a12,12,0,0,1,24,0Z"/></svg>';
      retryBtn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        timeoutDiv.remove();

        var retryMessage = JR.buildMessage({
          question: question, text: text, sentence: sentence, mode: st.responseMode,
          wholeResponse: !!wholeResponse, wholeResponseFull: wholeResponseFull,
        });

        // Reset item to __PENDING__ so captureResponse overwrites in-place
        var retryHlId = editOpts ? editOpts.hlId : (preRegisteredHlId || detachedHlId);
        var retryItemId = null;
        if (retryHlId) {
          var retryEntry = st.completedHighlights.get(retryHlId);
          if (retryEntry) {
            retryEntry.responseHTML = "__PENDING__";
            var retryIdx = retryEntry.activeItemIndex || 0;
            if (retryEntry.items && retryEntry.items[retryIdx]) {
              retryEntry.items[retryIdx].responseHTML = "__PENDING__";
              retryItemId = retryEntry.items[retryIdx].id;
            }
          }
        }

        targetPopup.appendChild(JR.createLoadingDiv());

        JR.enqueueMessage({
          force: true,
          message: retryMessage,
          waitOpts: {
            popup: targetPopup, text: text, sentence: sentence,
            blockTypes: blockTypes, parentId: parentId, question: question,
            wholeResponse: wholeResponse, wholeResponseFull: wholeResponseFull,
            preRegisteredHlId: retryHlId, preRegisteredItemId: retryItemId
          },
          beforeSend: function (w) { JR.prepareSend(w, null); },
        });
      });
      timeoutDiv.appendChild(retryBtn);
      targetPopup.appendChild(timeoutDiv);
    }

    /**
     * Save __TIMEOUT__ as a concrete version and rebuild the popup.
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
        // Edit: create a new version item with __TIMEOUT__
        var newItemId = crypto.randomUUID();
        memEntry.items.push({ id: newItemId, question: question, responseHTML: "__TIMEOUT__", turnKeys: hideKeys });
        memEntry.activeItemIndex = memEntry.items.length - 1;
        memEntry.question = question;
        memEntry.responseHTML = "__TIMEOUT__";
        saveHighlight({
          id: newItemId, quoteId: hlId, text: text, responseHTML: "__TIMEOUT__", question: question,
          url: convUrl, parentId: parentId || null,
          parentItemId: (memEntry && memEntry.parentItemId) || parentItemId || null,
          sourceTurnKey: memEntry.sourceTurnKey || null, turnKeys: hideKeys, active: true,
          wholeResponse: !!memEntry.wholeResponse,
        });
      } else {
        // New highlight (pre-registered or detached): update the pending item to __TIMEOUT__
        var itemIdx = memEntry.activeItemIndex || 0;
        if (memEntry.items && memEntry.items.length > itemIdx) {
          memEntry.items[itemIdx].responseHTML = "__TIMEOUT__";
          memEntry.items[itemIdx].turnKeys = hideKeys;
        }
        memEntry.responseHTML = "__TIMEOUT__";
        var updateId = preRegisteredItemId
          || (memEntry.items && memEntry.items[itemIdx] ? memEntry.items[itemIdx].id : null);
        if (updateId) {
          updateHighlightFields(updateId, { responseHTML: "__TIMEOUT__", turnKeys: hideKeys, question: question }, convUrl);
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
      var frozen = JR.unfreezeChat();
      // Turns the freeze hid that turned out not to be ours: show them again.
      var notOurs = frozen.filter(function (k) { return qaKeys.indexOf(k) === -1; });
      if (notOurs.length && qaKeys.length) JR.unhideTurnKeys(notOurs);
      if (streamObserver) {
        streamObserver.disconnect();
        streamObserver = null;
      }
      if (streamRafId) {
        cancelAnimationFrame(streamRafId);
        streamRafId = null;
      }
      if (unlockScroll) unlockScroll();
      document.querySelectorAll(".jr-popup--streaming").forEach(function (p) { p.classList.remove("jr-popup--streaming"); });
      setTimeout(JR.diagnose, 500); // keep #jr-diagnostics current after each send
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
      if (fresh) {
        responseTurn = fresh;
        if (streamObserver) observeStream();
      }
      return fresh;
    }

    /**
     * Clone current response content into the popup (replaceChildren instead
     * of innerHTML to avoid flicker).
     */
    function syncStreamContent() {
      streamDirty = false;
      streamRafId = null;
      if (JR.perf) JR.perf.count("streamSync");

      var turn = liveResponseTurn();
      if (!turn) return;
      if (JR.site.renderFailed(turn)) return; // ChatGPT's "couldn't load" — the network text is shown instead
      // ChatGPT mounts an empty answer placeholder first: keep "Waiting for response…" until text arrives.
      if (!JR.site.assistantText(turn).trim()) return;
      var targetPopup = getStreamTarget();
      if (!targetPopup) return;

      // Create or reuse the response div
      var responseDiv = targetPopup.querySelector(".jr-popup-response");
      var isNew = false;
      if (!responseDiv) {
        responseDiv = document.createElement("div");
        responseDiv.className = "jr-popup-response";
        isNew = true;
      }
      if (!syncAnswerInto(responseDiv, turn)) return;
      targetPopup.classList.add("jr-popup--streaming");
      if (isNew) {
        var loadingEl = targetPopup.querySelector(".jr-popup-loading");
        if (loadingEl) loadingEl.remove();
        targetPopup.appendChild(responseDiv);
      }

      // Delegated click handler for links + images (attach once via shared helper)
      if (JR.wireResponseClicks) JR.wireResponseClicks(responseDiv);

      // Check if the popup overflows and needs to flip direction mid-stream
      JR.checkStreamingOverflow();

      // Reposition "above" popups so the arrow stays anchored to the highlight
      // (popup grows upward as content streams in)
      if (targetPopup._jrLockedDirection === "above" || isNew) {
        JR.repositionPopup();
      }
    }

    /**
     * MutationObserver callback — coalesces into one sync per frame.
     */
    function onStreamMutation() {
      if (streamDirty) return;
      streamDirty = true;
      streamRafId = requestAnimationFrame(syncStreamContent);
    }

    function observeStream() {
      if (streamObserver) streamObserver.disconnect();
      streamObserver = new MutationObserver(onStreamMutation);
      streamObserver.observe(responseTurn, { childList: true, subtree: true, characterData: true });
    }

    /**
     * Attach a MutationObserver to the response turn so the popup
     * updates at the same speed ChatGPT renders tokens.
     */
    function startStreaming() {
      syncStreamContent();
      observeStream();
    }

    st.cancelResponseWatch = function (detachMode) {
      if (detachMode) {
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
            responseHTML: null,
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
        return;
      }
      cancelled = true;
      if (timerId) clearTimeout(timerId);
      cleanup();
      unhideTurns();
      removeHiddenTurns(convUrl, qaKeys);
    };

    function captureIfLive() {
      if (!cancelled) captureResponse();
    }

    function captureResponse() {
      var spans = detached ? detachedSpans : st.activeSourceHighlights;

      // Stop streaming before final capture
      if (streamObserver) {
        streamObserver.disconnect();
        streamObserver = null;
      }
      if (streamRafId) {
        cancelAnimationFrame(streamRafId);
        streamRafId = null;
      }

      var turn = liveResponseTurn();
      var responseHTML = null;
      if (domAnswerUsable()) {
        responseHTML = JR.site.assistantHTML(turn);
      } else if (net.text.trim()) {
        responseHTML = JR.renderMarkdown(net.text); // turn not in the DOM, or ChatGPT failed to render it
      } else if (turn) {
        // Empty answer (user stopped, error): save as __TIMEOUT__
        finishWithTimeout();
        return;
      } else {
        // Finished while scrolled out of the DOM and no network copy: keep the
        // keys; the content is read back when the turn mounts again (JR.qa).
        responseHTML = "__LOADING__";
      }
      if (responseHTML !== "__LOADING__") qaKeys.forEach(function (k) {
        JR.qa.put(k, { question: question, text: text, sentence: sentence, responseHTML: responseHTML, isPopup: true });
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
          memEntry.items.push({ id: newItemId, question: question, responseHTML: responseHTML, turnKeys: qaKeys.slice() });
          memEntry.activeItemIndex = memEntry.items.length - 1;
          memEntry.question = question;
          memEntry.responseHTML = responseHTML;
        }

        // Persist new item (deactivates old items with same quoteId; old items keep their own turn keys)
        saveHighlight({
          id: newItemId,
          quoteId: hlId,
          text: text,
          responseHTML: responseHTML,
          url: convUrl,
          parentId: parentId || null,
          parentItemId: resolveParentItemId(memEntry, parentId) || parentItemId || null,
          sourceTurnKey: (memEntry && memEntry.sourceTurnKey) || sourceTurnKey,
          turnKeys: qaKeys,
          active: true,
          wholeResponse: memEntry ? !!memEntry.wholeResponse : false,
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
        e.responseHTML = responseHTML;
        e.question = e.question || question || null;
        if (!e.sourceTurnKey) e.sourceTurnKey = sourceTurnKey;
        var found = false;
        if (e.items && itemId) {
          for (var di = 0; di < e.items.length; di++) {
            if (e.items[di].id === itemId) {
              e.items[di].responseHTML = responseHTML;
              e.items[di].turnKeys = qaKeys.slice();
              found = true;
              break;
            }
          }
        }
        if (!found && e.items && e.items.length > 0 && (e.items[0].responseHTML === "__PENDING__" || !itemId)) {
          e.items[0].responseHTML = responseHTML;
          e.items[0].turnKeys = qaKeys.slice();
          found = true;
        }
        if (!found && (!e.items || e.items.length === 0)) {
          e.items = [{ id: crypto.randomUUID(), question: question || null, responseHTML: responseHTML, turnKeys: qaKeys.slice() }];
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
            responseHTML: responseHTML,
            text: text,
            sentence: sentence,
            blockTypes: blockTypes,
            question: question || null,
            contentContainer: popup.parentElement,
            parentId: parentId || null,
            parentItemId: parentItemId || null,
            sourceTurnKey: sourceTurnKey,
            items: [{ id: itemId2, question: question || null, responseHTML: responseHTML, turnKeys: qaKeys.slice() }],
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
          responseHTML: responseHTML,
          turnKeys: qaKeys,
          sourceTurnKey: (entry && entry.sourceTurnKey) || sourceTurnKey,
        }, convUrl);
      } else {
        saveHighlight({
          id: persistItemId,
          quoteId: hlId2,
          text: text,
          responseHTML: responseHTML,
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
    var lastContentChangeTime = Date.now();
    var STALE_THRESHOLD = 10000; // 10 seconds of no content change → force capture
    var savedKeys = false;

    function poll() {
      if (cancelled || injectionFailed) return;

      // 1. Recognise the turn(s) our send created.
      var fresh = JR.findNewTurns(snap, message);
      if (fresh.length) {
        var added = [];
        for (var fi = 0; fi < fresh.length; fi++) {
          var fk = JR.site.turnKey(fresh[fi]);
          if (fk && qaKeys.indexOf(fk) === -1) { qaKeys.push(fk); added.push(fk); }
        }
        if (added.length) {
          JR.hideTurnKeys(added);
          st.watchingTurnKey = qaKeys[qaKeys.length - 1];
          // Persist right away so a reload mid-answer still hides the Q&A and
          // can read the answer back (the item loads instead of "failed").
          addDeletedTurns(convUrl, added);
          if (!editOpts && preRegisteredItemId) updateHighlightFields(preRegisteredItemId, { turnKeys: qaKeys.slice() }, convUrl);
          if (!savedKeys) { savedKeys = true; JR.repositionPopup(); }
        }
        if (!responseKey) {
          for (var ri = fresh.length - 1; ri >= 0; ri--) {
            if (JR.isAssistantTurn(fresh[ri])) {
              responseTurn = fresh[ri];
              responseKey = JR.site.turnKey(responseTurn);
              startStreaming();
              break;
            }
          }
        }
      }

      var turn = liveResponseTurn();
      var generating = JR.isGenerating();

      // 2. Done: ChatGPT stopped generating and the answer has text.
      if (turn && !generating && JR.site.assistantText(turn).trim().length > 0) {
        if (streamObserver) syncStreamContent();
        setTimeout(captureIfLive, 300);
        return;
      }
      // Done per the network stream while the DOM answer isn't usable
      // (turn never mounted, or ChatGPT's "couldn't load").
      if (net.done && net.text.trim() && !domAnswerUsable()) {
        setTimeout(captureIfLive, 300);
        return;
      }
      // Done while the answer is scrolled out of the DOM (keys known, content later).
      if (responseKey && !turn && !generating && !net.matched) {
        setTimeout(captureIfLive, 300);
        return;
      }

      // Stale-content safeguard: generating flag stuck but the (mounted) answer stopped changing.
      if (turn && generating) {
        var currentContent = JR.site.assistantText(turn);
        if (currentContent !== lastContentSnapshot) {
          lastContentSnapshot = currentContent;
          lastContentChangeTime = Date.now();
        } else if (currentContent.trim() && Date.now() - lastContentChangeTime >= STALE_THRESHOLD) {
          console.warn("[Popup] Response stale for " + STALE_THRESHOLD + "ms — force capturing");
          setTimeout(captureIfLive, 300);
          return;
        }
      }

      // ChatGPT refused the send ("wait for this response to finish") and put
      // our message back in its input box: clear it at once (the user must never
      // see it), then send again when ChatGPT is really idle — once.
      if (!qaKeys.length && !net.matched && !rejected.pending && Date.now() - startTime >= 1500) {
        var composer = JR.site.composer();
        var probe = norm60(message).slice(0, 30);
        if (composer && probe && norm60(JR.site.composerText(composer)).indexOf(probe) !== -1) {
          clearComposer(composer);
          if (rejected.count >= 1) {
            st.lastSendReport = { ok: false, stage: "rejected", detail: "ChatGPT refused the message twice", when: new Date().toISOString() };
            finishWithTimeout();
            return;
          }
          rejected.count++;
          rejected.pending = true;
          st.lastSendReport = { ok: false, stage: "retrying", detail: "ChatGPT was still busy; will resend", when: new Date().toISOString() };
          (function resendWhenIdle(tries) {
            if (cancelled) return;
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

      // Hard 10-second timeout: no answer text and ChatGPT isn't working on it.
      if (Date.now() - startTime >= 10000) {
        var hasRealContent = (turn && JR.site.assistantText(turn).trim().length >= 1) || net.text.trim().length >= 1;
        if (!hasRealContent && !generating && !(net.matched && !net.done)) {
          finishWithTimeout();
          return;
        }
      }

      if (Date.now() - startTime >= timeoutMs) {
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
        if (cancelled) return;
        injectionFailed = true;
        if (timerId) clearTimeout(timerId);
        cleanup();
        unhideTurns();
        saveTimeoutVersion();
        st.cancelResponseWatch = null;
        JR.drainQueue();
      },
    };
    return watch;
  };
})();

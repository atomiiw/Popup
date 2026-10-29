// content.js — Event listeners, navigation handling, and initialization for Popup
(function () {
  "use strict";

  var st = JR.state;
  var mouseIsDown = false;
  var triggerBtn = null; // floating "open popup" button after highlight
  var triggerData = null; // saved selection data for the trigger

  document.addEventListener("mousedown", function () { mouseIsDown = true; }, true);
  document.addEventListener("mouseup", function () { mouseIsDown = false; }, true);

  // --- Trigger button helpers ---

  var triggerResizeHandler = null;
  var triggerSelChangeHandler = null;

  function removeTriggerBtn() {
    if (triggerResizeHandler) {
      window.removeEventListener("resize", triggerResizeHandler);
      triggerResizeHandler = null;
    }
    if (triggerSelChangeHandler) {
      document.removeEventListener("selectionchange", triggerSelChangeHandler);
      triggerSelChangeHandler = null;
    }
    if (triggerBtn) {
      triggerBtn.remove();
      triggerBtn = null;
      triggerData = null;
    }
  }
  JR.removeTriggerBtn = removeTriggerBtn;

  /**
   * Show trigger button for a selection.
   * @param {object} result - { text, sentence, blockTypes, rect, range }
   * @param {object} [opts] - { parentId } for chained (inside popup response)
   */
  function showTriggerBtn(result, opts) {
    removeTriggerBtn();
    triggerData = result;
    var chainParentId = opts && opts.parentId ? opts.parentId : null;

    triggerBtn = document.createElement("button");
    triggerBtn.type = "button";
    triggerBtn.className = "jr-highlight-trigger-btn";
    triggerBtn.innerHTML = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M216,36H40A20,20,0,0,0,20,56V184a20,20,0,0,0,20,20H98.11l12.52,21.92a20,20,0,0,0,34.74,0L157.89,204H216a20,20,0,0,0,20-20V56A20,20,0,0,0,216,36Zm-4,144H150.93a12,12,0,0,0-10.42,6.05L128,207.94l-12.51-21.89A12,12,0,0,0,105.07,180H44V60H212Z"/></svg>';
    triggerBtn.title = "Follow up";
    triggerBtn.setAttribute("aria-label", "Follow up on selection");

    // The button lives inside the content that scrolls (the popup response for a
    // selection in a popup, else the full-height conversation list), so it moves
    // with the text natively — no scroll handler, no lag.
    var startNode = result.range ? result.range.startContainer : null;
    var startEl = startNode && (startNode.nodeType === Node.TEXT_NODE ? startNode.parentElement : startNode);
    var inPopup = startEl && startEl.closest(".jr-popup");
    var host = (inPopup && startEl.closest(".jr-popup-response")) ||
      JR.site.popupHost(startEl ? JR.site.turnOf(startEl) : null);

    function positionBtn() {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        removeTriggerBtn();
        return;
      }
      var range = sel.getRangeAt(0);
      var r = range.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) {
        removeTriggerBtn();
        return;
      }
      var btnSize = triggerBtn.offsetWidth || 32;
      var rects = range.getClientRects();
      var maxRight = r.right;
      for (var ri = 0; ri < rects.length; ri++) {
        if (rects[ri].right > maxRight) maxRight = rects[ri].right;
      }
      // Clamp to the popup edge if selection is inside a popup
      var rightLimit = window.innerWidth - btnSize - 4;
      var parentPopup = range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement && range.startContainer.parentElement.closest(".jr-popup")
        : range.startContainer.closest && range.startContainer.closest(".jr-popup");
      if (parentPopup) {
        var popupRect = parentPopup.getBoundingClientRect();
        rightLimit = popupRect.right - btnSize - 6;
      }
      // Viewport coords → host coords (+ the host's own scroll for a popup response)
      var hr = host.getBoundingClientRect();
      triggerBtn.style.left = (Math.min(maxRight + 6, rightLimit) - hr.left + host.scrollLeft) + "px";
      triggerBtn.style.top = (r.top + r.height / 2 - (triggerBtn.offsetHeight || 32) / 2 - hr.top + host.scrollTop) + "px";
    }

    triggerBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      e.preventDefault();
      var data = triggerData;
      removeTriggerBtn();
      if (!data) return;

      // Compute sentence context now (deferred from selection time for speed)
      if (!data.sentence && data.range) {
        try {
          var blockTypes = [];
          data.sentence = JR.extractSentence(data.range, blockTypes);
          if (blockTypes.length > 0) data.blockTypes = blockTypes;
        } catch (ex) { /* sentence context is optional */ }
      }

      // Clear native selection
      var sel = window.getSelection();
      if (sel) sel.removeAllRanges();
      if (chainParentId) {
        // Chained popup inside a popup response
        JR.pushPopupState();
        JR.createPopup({ text: data.text, parentId: chainParentId, range: data.range });
      } else {
        // Page-level popup
        JR.removeAllPopups();
        JR.createPopup({ text: data.text, sentence: data.sentence, blockTypes: data.blockTypes, rect: data.rect, range: data.range });
      }
      // Auto-focus the question input
      if (st.activePopup) {
        var input = st.activePopup.querySelector(".jr-popup-question-text[contenteditable]");
        if (input) {
          requestAnimationFrame(function () { input.focus(); });
        }
      }
    });

    // Inside a popup response the popup's own mouseup handler would re-create
    // the button (selection still exists) before this click lands.
    triggerBtn.addEventListener("mousedown", function (e) {
      e.stopPropagation();
    });
    triggerBtn.addEventListener("mouseup", function (e) {
      e.stopPropagation();
    });

    host.appendChild(triggerBtn);
    positionBtn();

    // Reposition when the layout changes (not on scroll: it scrolls with the text);
    // remove when the selection disappears.
    triggerResizeHandler = function () { if (triggerBtn) positionBtn(); };
    triggerSelChangeHandler = function () {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        removeTriggerBtn();
      }
    };
    window.addEventListener("resize", triggerResizeHandler);
    document.addEventListener("selectionchange", triggerSelChangeHandler);
  }
  JR.showTriggerBtn = showTriggerBtn;

  // --- Selection listener ---

  function handleSelectionChange() {
    if (st.confirmingDelete) return;
    removeTriggerBtn();
    // Quick check: is there a valid selection in an AI response?
    var result = JR.getSelectedTextQuick();
    if (!result) return;
    showTriggerBtn(result);
  }

  document.addEventListener("mouseup", function (e) {
    if (e.target.closest(".jr-highlight-trigger-btn")) return;
    if (st.navWidget && st.navWidget.contains(e.target)) return;
    if (st.activePopup && st.activePopup.contains(e.target)) return;
    if (st.activePopup) {
      var hlSpan = e.target.closest(".jr-source-highlight");
      if (hlSpan && st.activeSourceHighlights.indexOf(hlSpan) !== -1) {
        var sel = window.getSelection();
        if (sel.isCollapsed) JR.selectSourceHighlightText();
        return;
      }
    }
    if (e.target.closest(".jr-source-highlight-done")) return;
    setTimeout(handleSelectionChange, 10);
  });

  // --- Dismissal ---

  document.addEventListener("mousedown", function (e) {
    // Ignore clicks on the trigger button
    if (e.target.closest(".jr-highlight-trigger-btn")) return;
    // Dismiss trigger button on click outside
    if (triggerBtn && !triggerBtn.contains(e.target)) {
      removeTriggerBtn();
    }
    if (!st.activePopup && st.popupStack.length === 0) return;
    if (st.confirmingDelete) {
      // Click outside popup cancels delete confirmation
      if (st.activePopup && !st.activePopup.contains(e.target)) {
        st.confirmingDelete = false;
        JR.removeAllPopups();
      }
      return;
    }
    var hlSpan = e.target.closest(".jr-source-highlight");
    if (hlSpan) {
      if (st.activeSourceHighlights.indexOf(hlSpan) !== -1) return;
      for (var i = 0; i < st.popupStack.length; i++) {
        if (st.popupStack[i].sourceHighlights.indexOf(hlSpan) !== -1) return;
      }
      if (st.activeHighlightId && hlSpan.getAttribute("data-jr-highlight-id") === st.activeHighlightId) return;
    }
    JR.removeAllPopups();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (triggerBtn) { removeTriggerBtn(); return; }
      if (!st.activePopup) return;
      if (st.confirmingDelete) return;
      JR.removePopup();
    }
  });

  // Click on active source highlight → select text for copy;
  // click on completed highlight → open popup
  document.addEventListener("click", function (e) {
    if (st.confirmingDelete) return;
    if (st.activePopup) {
      var hlSpan = e.target.closest(".jr-source-highlight");
      if (hlSpan && st.activeSourceHighlights.indexOf(hlSpan) !== -1) {
        JR.selectSourceHighlightText();
        return;
      }
    }
    var span = e.target.closest(".jr-source-highlight-done");
    if (!span) return;
    var hlId = span.getAttribute("data-jr-highlight-id");
    if (!hlId || !st.completedHighlights.has(hlId)) return;
    if (st.activePopup && st.activeHighlightId && hlId === st.activeHighlightId) {
      JR.selectSourceHighlightText();
      return;
    }
    e.stopPropagation();
    if (span.closest(".jr-popup")) {
      JR.pushPopupState();
    } else {
      JR.removeAllPopups();
    }
    JR.createPopup({ completedId: hlId });
  });

  // --- Underline on highlights (hover + active) ---

  var hoverUnderlines = [];
  var hoveredHlId = null;
  var activeUnderlines = [];
  var lastMouseX = 0;
  var lastMouseY = 0;
  document.addEventListener("mousemove", function (e) {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  }, true);

  function removeElems(arr) {
    for (var i = 0; i < arr.length; i++) arr[i].remove();
    arr.length = 0;
  }

  /**
   * Create underline elements for a highlight entry.
   * Works for page-level and popup-level highlights.
   * @param {object} entry
   * @param {object} [opts] - { allowScrollParent: true } to place underlines inside scroll containers
   */
  JR.createUnderlines = function (entry, opts) {
    opts = opts || {};
    var elems = [];
    if (!entry || !entry.spans || entry.spans.length === 0) return elems;

    var allRects = [];
    var hlId = entry.spans[0].getAttribute("data-jr-highlight-id");
    for (var i = 0; i < entry.spans.length; i++) {
      var span = entry.spans[i];
      // A proxy (chart / code text) stands over one line of its text: its own box is that line.
      var rRects = span._jrProxyGroup ? [span.getBoundingClientRect()] : JR.spanRange(span).getClientRects();
      // Inside a formula, pieces sit at different heights (fractions, sub/superscripts):
      // put them all on the bottom of their formula line so they share one underline.
      var mathLine = span.closest(JR.site.mathSelector) && span.closest(JR.site.mathLineSelector);
      var lineBottom = mathLine ? mathLine.getBoundingClientRect().bottom : null;
      for (var r = 0; r < rRects.length; r++) {
        var rr = rRects[r];
        allRects.push(lineBottom === null ? rr : { left: rr.left, right: rr.right, bottom: lineBottom, width: rr.width, height: rr.height });
      }

      // If there's a next span, collect rects from any inner highlight spans
      // sitting between this span and the next (wrapping case).
      // Only include spans that belong to this same highlight (same hlId).
      if (i < entry.spans.length - 1) {
        var sib = span.nextElementSibling;
        while (sib && sib !== entry.spans[i + 1]) {
          if (sib.classList.contains("jr-source-highlight-done") &&
              sib.getAttribute("data-jr-highlight-id") === hlId) {
            var innerRange = document.createRange();
            innerRange.selectNodeContents(sib);
            var iRects = innerRange.getClientRects();
            for (var ir = 0; ir < iRects.length; ir++) allRects.push(iRects[ir]);
          }
          sib = sib.nextElementSibling;
        }
      }
    }
    if (allRects.length === 0) return elems;

    // Group rects by line (same approximate bottom)
    var lines = [];
    for (var ri = 0; ri < allRects.length; ri++) {
      var rect = allRects[ri];
      if (rect.width === 0 && rect.height === 0) continue;
      var found = false;
      for (var li = 0; li < lines.length; li++) {
        if (Math.abs(lines[li].bottom - rect.bottom) < 8) {
          lines[li].left = Math.min(lines[li].left, rect.left);
          lines[li].right = Math.max(lines[li].right, rect.right);
          found = true;
          break;
        }
      }
      if (!found) {
        lines.push({ left: rect.left, right: rect.right, bottom: rect.bottom });
      }
    }

    // Find the nearest positioned ancestor for underline placement.
    // For active (persistent) underlines: skip scroll containers and
    // .jr-popup-response to avoid extending scrollable overflow.
    // For hover (temporary) underlines: allow .jr-popup-response so
    // underlines scroll with the content, matching page-level behavior.
    var posParent = null;
    var el = entry.spans[0].parentElement;
    while (el) {
      if (!opts.allowScrollParent && el.classList.contains("jr-popup-response")) { el = el.parentElement; continue; }
      var cs = getComputedStyle(el);
      if (cs.position === "relative" || cs.position === "absolute" || cs.position === "fixed") {
        if (opts.allowScrollParent || (cs.overflowY !== "auto" && cs.overflowY !== "scroll")) {
          posParent = el;
          break;
        }
      }
      el = el.parentElement;
    }
    if (!posParent) {
      posParent = entry.contentContainer;
      if (!posParent || !posParent.isConnected) {
        posParent = JR.site.popupHost(JR.site.turnOf(entry.spans[0]));
      }
    }
    var pRect = posParent.getBoundingClientRect();
    var pStyle = getComputedStyle(posParent);
    var borderLeft = parseFloat(pStyle.borderLeftWidth) || 0;
    var borderTop = parseFloat(pStyle.borderTopWidth) || 0;
    var scrollOffsetX = posParent.scrollLeft || 0;
    var scrollOffsetY = posParent.scrollTop || 0;

    for (var ui = 0; ui < lines.length; ui++) {
      var line = lines[ui];
      var underline = document.createElement("div");
      underline.className = "jr-highlight-underline";
      underline.style.left = (line.left - pRect.left - borderLeft + scrollOffsetX) + "px";
      underline.style.top = (line.bottom - pRect.top - borderTop + scrollOffsetY + 1) + "px";
      underline.style.width = (line.right - line.left) + "px";
      posParent.appendChild(underline);
      elems.push(underline);
    }
    return elems;
  };

  // Hover underline — when no popup is open, or for children of the innermost open popup
  document.addEventListener("mouseover", function (e) {
    if (mouseIsDown) return;
    var span = e.target.closest(".jr-source-highlight-done");
    if (!span) {
      removeElems(hoverUnderlines);
      hoveredHlId = null;
      return;
    }
    var hlId = span.getAttribute("data-jr-highlight-id");
    if (!hlId || !st.completedHighlights.has(hlId)) return;

    // When a popup is open, only allow hover underline for children of the
    // innermost open popup (i.e. highlights whose parentId === activeHighlightId)
    if (st.activePopup) {
      var hovEntry = st.completedHighlights.get(hlId);
      if (!hovEntry || hovEntry.parentId !== st.activeHighlightId) {
        if (hoveredHlId) { removeElems(hoverUnderlines); hoveredHlId = null; }
        return;
      }
    }

    if (hoveredHlId === hlId) return;
    removeElems(hoverUnderlines);
    hoveredHlId = hlId;
    hoverUnderlines = JR.createUnderlines(st.completedHighlights.get(hlId), { allowScrollParent: true });
  });

  document.addEventListener("mouseout", function (e) {
    var span = e.target.closest(".jr-source-highlight-done");
    if (!span) return;
    var related = e.relatedTarget;
    if (related) {
      var relatedSpan = related.closest && related.closest(".jr-source-highlight-done");
      if (relatedSpan && relatedSpan.getAttribute("data-jr-highlight-id") === hoveredHlId) return;
    }
    removeElems(hoverUnderlines);
    hoveredHlId = null;
  });

  // On scroll, check if mouse is still over the hovered highlight — remove underline if not
  document.addEventListener("scroll", function () {
    if (!hoveredHlId) return;
    var elUnder = document.elementFromPoint(lastMouseX, lastMouseY);
    if (!elUnder || !elUnder.closest || !elUnder.closest(".jr-source-highlight-done[data-jr-highlight-id=\"" + hoveredHlId + "\"]")) {
      removeElems(hoverUnderlines);
      hoveredHlId = null;
    }
  }, true);

  // Active underline — shown while popup is open (accepts single ID or array)
  JR.showActiveUnderline = function (hlIds) {
    removeElems(activeUnderlines);
    if (!Array.isArray(hlIds)) hlIds = [hlIds];
    for (var i = 0; i < hlIds.length; i++) {
      var entry = st.completedHighlights.get(hlIds[i]);
      if (entry && !(entry.spans && entry.spans[0] && entry.spans[0]._jrReplyAnchor)) {
        var elems = JR.createUnderlines(entry);
        for (var j = 0; j < elems.length; j++) activeUnderlines.push(elems[j]);
      }
    }
    // Clear any hover underline
    removeElems(hoverUnderlines);
    hoveredHlId = null;
  };

  JR.removeActiveUnderline = function () {
    removeElems(activeUnderlines);
  };


  // --- SPA navigation ---

  function onNavigate() {
    var currentUrl = location.href;
    if (currentUrl === st.lastKnownUrl) return;
    st.lastKnownUrl = currentUrl;

    JR.removeAllPopups();
    JR.unfreezeChat();
    document.documentElement.removeAttribute("data-jr-scroll-lock");
    JR.setTailHidden(false);
    JR.clearHiddenTurnKeys();
    JR.qa.clear();
    JR.qa.resetApi();
    resetStorageCache();
    var early = document.getElementById("jr-early-hide");
    if (early) early.remove();
    st.messageQueue.length = 0;
    if (st.navWidget) {
      if (st.navWidget._jrScrollCleanup) st.navWidget._jrScrollCleanup();
      st.navWidget.remove();
      st.navWidget = null;
    }
    st.completedHighlights.forEach(function (entry) {
      for (var i = 0; i < entry.spans.length; i++) {
        var span = entry.spans[i];
        var parent = span.parentNode;
        if (!parent) continue;
        while (span.firstChild) {
          parent.insertBefore(span.firstChild, span);
        }
        parent.removeChild(span);
        parent.normalize();
      }
    });
    st.completedHighlights.clear();
    // Hide rules are applied by restoreHighlights (CSS by turn key), so turns
    // that render before it runs are hidden the moment the rules land.
    JR.restoreHighlights();
  }

  window.addEventListener("popstate", onNavigate);

  // Navigation detection: content scripts can't hook the page's history.pushState
  // (isolated world), so poll the URL.
  setInterval(function () {
    if (location.href !== st.lastKnownUrl) {
      onNavigate();
    }
  }, 500);

  // Time the per-mount work that runs while the user scrolls (JR.diagnose perf).
  JR.diagnose = JR.perf.timed("diagnose", JR.diagnose);

  // Restore saved highlights on initial page load
  JR.restoreHighlights();
  JR.watchTurnMounts();
  // ChatGPT can replace its scroll container (e.g. after navigation); re-attach
  // the turn-mount observer if so. Cheap: one querySelector, no-op if unchanged.
  setInterval(JR.watchTurnMounts, 3000);


  // --- Layout change observer [LAYOUT-LOCKED] — Do not modify ---
  // ChatGPT sidebar open/close doesn't fire window.resize — it only changes
  // the chat column width via CSS. Observe the main content area so highlights,
  // underlines, popups, and arrows stay in sync.
  (function () {
    if (typeof ResizeObserver === "undefined") return;
    function findChatColumn() {
      return JR.site.chatColumn();
    }
    var lastW = 0;
    var observedEl = null;
    var ro = new ResizeObserver(function (entries) {
      var w = entries[0].contentRect.width;
      if (w === lastW) return;  // height-only change, ignore
      lastW = w;
      // Reposition popups/underlines/arrows and toggle nav widget visibility
      if (st.resizeHandler) st.resizeHandler();
      if (JR.updateNavWidget) JR.updateNavWidget();
    });
    function attach() {
      var el = findChatColumn();
      if (el && el !== observedEl) {
        if (observedEl) ro.unobserve(observedEl);
        observedEl = el;
        lastW = el.clientWidth;
        ro.observe(el);
      }
    }
    attach();
    // Re-attach after SPA navigations (React may recreate the element)
    setInterval(attach, 3000);
  })();

  // --- Expose console API to page's main world ---
  // Content scripts run in an isolated world; the browser console
  // runs in the main world. Bridge via CustomEvents on document.
  document.addEventListener("jr-diagnose", function (e) {
    var report = JR.diagnose(e.detail ? JSON.parse(e.detail) : undefined);
    console.log("[Popup] diagnose", report);
  });

  // Bridge script (src/console-bridge.js) runs in MAIN world via manifest,
  // exposing JR.diagnose() to the browser console.
})();

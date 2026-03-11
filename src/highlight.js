// highlight.js — Highlight creation, removal, and restoration for Jump Return
(function () {
  "use strict";

  var S = JR.SELECTORS;
  var st = JR.state;

  /**
   * Wrap the text nodes within a range in <span class="jr-source-highlight">.
   * Returns an array of all wrapper spans created.
   */
  JR.highlightRange = function (range) {
    var wrappers = [];
    try {
      if (!range || range.collapsed) {
        console.warn("[JR] highlightRange: range is", range ? "collapsed" : "null");
        return wrappers;
      }
      var startNode = range.startContainer;
      var endNode = range.endContainer;
      var commonAncestor = range.commonAncestorContainer;

      var startOffset = range.startOffset;
      var endOffset = range.endOffset;

      // Single text node
      if (startNode === endNode && startNode.nodeType === Node.TEXT_NODE) {
        var so = Math.min(startOffset, startNode.length);
        var eo = Math.min(endOffset, startNode.length);
        if (so >= eo) return wrappers;
        var span = document.createElement("span");
        span.className = "jr-source-highlight";
        var selectedText = startNode.splitText(so);
        selectedText.splitText(eo - so);
        startNode.parentNode.insertBefore(span, selectedText);
        span.appendChild(selectedText);
        wrappers.push(span);
        return wrappers;
      }

      // Multi-node: collect text nodes
      var walker = document.createTreeWalker(
        commonAncestor,
        NodeFilter.SHOW_TEXT,
        null
      );
      var textNodes = [];
      var node;
      while ((node = walker.nextNode())) {
        if (range.intersectsNode(node)) {
          textNodes.push(node);
        }
      }

      if (textNodes.length === 0) return wrappers;

      // If the range spans both inside and outside an existing completed
      // highlight, skip text nodes inside it so the new highlight wraps
      // around the existing one and both remain independently visible.
      var hasInsideDone = false;
      var hasOutsideDone = false;
      for (var ci = 0; ci < textNodes.length; ci++) {
        if (textNodes[ci].parentElement && textNodes[ci].parentElement.closest(".jr-source-highlight-done")) {
          hasInsideDone = true;
        } else {
          hasOutsideDone = true;
        }
        if (hasInsideDone && hasOutsideDone) break;
      }
      var filteredWrapping = hasInsideDone && hasOutsideDone;
      if (filteredWrapping) {
        var filtered = [];
        for (var fi = 0; fi < textNodes.length; fi++) {
          if (!textNodes[fi].parentElement || !textNodes[fi].parentElement.closest(".jr-source-highlight-done")) {
            filtered.push(textNodes[fi]);
          }
        }
        textNodes = filtered;
        if (textNodes.length === 0) return wrappers;
      }

      var firstTextNode = textNodes[0];
      var lastTextNode = textNodes[textNodes.length - 1];
      var firstOffset = (firstTextNode === startNode)
        ? Math.min(startOffset, firstTextNode.length)
        : 0;
      var lastOffset = (lastTextNode === endNode)
        ? Math.min(endOffset, lastTextNode.length)
        : lastTextNode.length;

      // Process in reverse to preserve earlier offsets
      for (var i = textNodes.length - 1; i >= 0; i--) {
        var tn = textNodes[i];
        var spanEl = document.createElement("span");
        spanEl.className = "jr-source-highlight";

        if (tn === firstTextNode && tn === lastTextNode) {
          if (firstOffset >= lastOffset) continue;
          var sel = tn.splitText(firstOffset);
          sel.splitText(lastOffset - firstOffset);
          tn.parentNode.insertBefore(spanEl, sel);
          spanEl.appendChild(sel);
        } else if (tn === lastTextNode) {
          if (lastOffset > 0) {
            tn.splitText(lastOffset);
            tn.parentNode.insertBefore(spanEl, tn);
            spanEl.appendChild(tn);
          } else {
            continue;
          }
        } else if (tn === firstTextNode) {
          if (firstOffset < tn.length) {
            var after = tn.splitText(firstOffset);
            tn.parentNode.insertBefore(spanEl, after);
            spanEl.appendChild(after);
          } else {
            continue;
          }
        } else {
          tn.parentNode.insertBefore(spanEl, tn);
          spanEl.appendChild(tn);
        }
        wrappers.unshift(spanEl);
      }
      // Flag so pickNonConflictingColor knows wrapping occurred
      if (filteredWrapping && wrappers.length > 0) {
        wrappers[0]._jrWrapping = true;
      }
    } catch (e) {
      console.warn("[Jump Return] highlightRange failed:", e);
      for (var j = 0; j < wrappers.length; j++) {
        try {
          var w = wrappers[j];
          while (w.firstChild) w.parentNode.insertBefore(w.firstChild, w);
          w.remove();
        } catch (_) {}
      }
      return [];
    }
    return wrappers;
  };

  /**
   * If highlight spans overlap an existing completed highlight (either nested
   * inside or wrapping around), return a color that won't conflict.
   * Returns null when no conflict is detected (caller uses default blue).
   */
  JR.pickNonConflictingColor = function (spans) {
    if (spans.length === 0) return null;
    var colors = JR.HIGHLIGHT_COLORS;
    var conflictColor = null;

    // Helper: extract color from a done highlight element
    function colorFromDone(el) {
      var hlId = el.getAttribute("data-jr-highlight-id");
      if (!hlId) return "blue";
      var entry = st.completedHighlights.get(hlId);
      return (entry && entry.color) || "blue";
    }

    // Build a Set of new span elements so the broad scan can skip them
    var spanSet = new Set();
    for (var si2 = 0; si2 < spans.length; si2++) spanSet.add(spans[si2]);

    // Case 1: new highlight is INSIDE an existing one — walk up from each span
    for (var i = 0; i < spans.length && !conflictColor; i++) {
      var ancestor = spans[i].parentElement;
      while (ancestor) {
        if (ancestor.classList && ancestor.classList.contains("jr-source-highlight-done")) {
          conflictColor = colorFromDone(ancestor);
          break;
        }
        ancestor = ancestor.parentElement;
      }
    }

    // Cases 2 & 3 only apply when highlightRange's filter detected wrapping
    var wrapping = spans.length > 0 && spans[0]._jrWrapping;

    // Case 2: new highlight wraps around an existing one — check siblings
    if (!conflictColor && wrapping) {
      for (var si = 0; si < spans.length && !conflictColor; si++) {
        // Walk forward
        var sib = spans[si].nextElementSibling;
        while (sib) {
          if (sib.classList.contains("jr-source-highlight-done")) {
            conflictColor = colorFromDone(sib);
            break;
          }
          if (sib.classList.contains("jr-source-highlight")) break;
          sib = sib.nextElementSibling;
        }
        if (conflictColor) break;
        // Walk backward
        var prev = spans[si].previousElementSibling;
        while (prev) {
          if (prev.classList.contains("jr-source-highlight-done")) {
            conflictColor = colorFromDone(prev);
            break;
          }
          if (prev.classList.contains("jr-source-highlight")) break;
          prev = prev.previousElementSibling;
        }
      }
    }

    // Case 3 (fallback): broad scan — when spans are at different DOM depths
    // (e.g. text inside <strong> or <a>), sibling walks miss highlights in
    // adjacent branches. Walk up to the nearest block ancestor and search
    // for done highlights positioned between the first and last new span.
    if (!conflictColor && wrapping && spans.length >= 2) {
      var firstSpan = spans[0];
      var lastSpan = spans[spans.length - 1];
      var block = firstSpan.parentElement;
      while (block && !JR.BLOCK_TAGS.has(block.tagName)) {
        block = block.parentElement;
      }
      if (!block) block = firstSpan.parentElement;
      var doneEls = block.querySelectorAll(".jr-source-highlight-done");
      for (var di = 0; di < doneEls.length; di++) {
        if (spanSet.has(doneEls[di])) continue;
        // Check that the done el is between first and last new span
        var pos1 = firstSpan.compareDocumentPosition(doneEls[di]);
        var pos2 = lastSpan.compareDocumentPosition(doneEls[di]);
        var afterFirst = !!(pos1 & Node.DOCUMENT_POSITION_FOLLOWING);
        var beforeLast = !!(pos2 & Node.DOCUMENT_POSITION_PRECEDING);
        if (afterFirst && beforeLast) {
          conflictColor = colorFromDone(doneEls[di]);
          break;
        }
      }
    }

    if (!conflictColor) return null;
    for (var c = 0; c < colors.length; c++) {
      if (colors[c] !== conflictColor) return colors[c];
    }
    return colors[1];
  };

  /**
   * Remove all source highlight spans and restore original DOM.
   */
  JR.removeSourceHighlight = function () {
    for (var i = 0; i < st.activeSourceHighlights.length; i++) {
      var span = st.activeSourceHighlights[i];
      var parent = span.parentNode;
      if (!parent) continue;
      while (span.firstChild) {
        parent.insertBefore(span.firstChild, span);
      }
      parent.removeChild(span);
      parent.normalize();
    }
    st.activeSourceHighlights = [];

    if (st.resizeHandler) {
      window.removeEventListener("resize", st.resizeHandler);
      st.resizeHandler = null;
    }
  };

  /**
   * Programmatically select all text across the active source highlight spans.
   * Creates a browser selection from the first to the last span so Ctrl+C works.
   */
  JR.selectSourceHighlightText = function () {
    if (st.activeSourceHighlights.length === 0) return;
    var sel = window.getSelection();
    sel.removeAllRanges();
    var range = document.createRange();
    range.setStartBefore(st.activeSourceHighlights[0]);
    range.setEndAfter(st.activeSourceHighlights[st.activeSourceHighlights.length - 1]);
    sel.addRange(range);
  };

  /**
   * Compute the combined bounding rect of an array of elements.
   */
  JR.getHighlightRect = function (wrappers) {
    var top = Infinity, left = Infinity, bottom = -Infinity, right = -Infinity;
    for (var i = 0; i < wrappers.length; i++) {
      var r = wrappers[i].getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.top < top) top = r.top;
      if (r.left < left) left = r.left;
      if (r.bottom > bottom) bottom = r.bottom;
      if (r.right > right) right = r.right;
    }
    return {
      top: top,
      left: left,
      bottom: bottom,
      right: right,
      width: right - left,
      height: bottom - top,
    };
  };

  /**
   * Walk the highlight chain to find the nearest ancestor with source highlight spans.
   */
  JR.getAncestorWithSpans = function (highlightId) {
    var entry = st.completedHighlights.get(highlightId);
    while (entry) {
      if (entry.spans && entry.spans.length > 0) return entry;
      if (entry.parentId) {
        entry = st.completedHighlights.get(entry.parentId);
      } else {
        break;
      }
    }
    return null;
  };

  /**
   * Restore a single highlight by text-matching within a root element.
   * Shared by restoreHighlights (level 1, page reload) and
   * createPopup with completedId (chained highlights inside popup response).
   */
  JR.restoreHighlightInElement = function (root, hl, contentContainer) {
    var range = JR.findTextRange(root, hl.text);
    if (!range) return false;
    var wrappers = JR.highlightRange(range);
    if (wrappers.length === 0) return false;
    for (var k = 0; k < wrappers.length; k++) {
      wrappers[k].setAttribute("data-jr-highlight-id", hl.id);
      wrappers[k].classList.add("jr-source-highlight-done");
      if (hl.color) {
        wrappers[k].classList.add("jr-highlight-color-" + hl.color);
      }
    }
    var entry = {
      spans: wrappers,
      responseHTML: hl.responseHTML,
      text: hl.text,
      sentence: hl.sentence,
      blockTypes: hl.blockTypes,
      question: hl.question || null,
      color: hl.color || null,
      contentContainer: contentContainer,
      parentId: hl.parentId || null,
      responseIndex: hl.responseIndex || -1,
    };
    // Preserve version data from storage
    if (hl.versions) {
      entry.versions = hl.versions;
      entry.activeVersion = hl.activeVersion != null ? hl.activeVersion : hl.versions.length - 1;
    }
    st.completedHighlights.set(hl.id, entry);
    return true;
  };

  /**
   * Hide turns from previously deleted highlights.
   * Polls the DOM since ChatGPT renders turns asynchronously.
   */
  JR.hideDeletedTurns = function (url) {
    getDeletedTurns(url).then(function (indices) {
      if (indices.length === 0) return;
      var attempts = 0;
      var maxAttempts = 30;
      var remaining = indices.slice();

      function tryHide() {
        var stillRemaining = [];
        for (var i = 0; i < remaining.length; i++) {
          var turn = document.querySelector(
            'article[data-testid="conversation-turn-' + remaining[i] + '"]'
          );
          if (turn) {
            turn.classList.add("jr-hidden");
          } else {
            stillRemaining.push(remaining[i]);
          }
        }
        remaining = stillRemaining;
        attempts++;
        if (remaining.length > 0 && attempts < maxAttempts) {
          setTimeout(tryHide, 500);
        }
      }
      tryHide();
    });
  };

  /**
   * Restore saved highlights for the current conversation URL.
   * Polls the DOM for the required turns to appear, then wraps the source text,
   * hides Q&A turns, and populates completedHighlights.
   */
  JR.restoreHighlights = function () {
    if (st.restoreTimer) {
      clearTimeout(st.restoreTimer);
      st.restoreTimer = null;
    }

    var url = location.href;

    // Hide turns from previously deleted highlights
    JR.hideDeletedTurns(url);

    getHighlightsByUrl(url).then(function (highlights) {
      if (highlights.length === 0) return;

      // Collect all turn indices to hide (level-1 and chained, all versions)
      var allTurnIndices = [];
      var restorable = [];
      for (var hi = 0; hi < highlights.length; hi++) {
        var h = highlights[hi];
        if (h.versions && h.versions.length > 0) {
          for (var vi = 0; vi < h.versions.length; vi++) {
            var ver = h.versions[vi];
            if (ver.questionIndex > 0) allTurnIndices.push(ver.questionIndex);
            if (ver.responseIndex > 0) allTurnIndices.push(ver.responseIndex);
          }
        } else {
          if (h.questionIndex > 0) allTurnIndices.push(h.questionIndex);
          if (h.responseIndex > 0) allTurnIndices.push(h.responseIndex);
        }
        // Only level-1 highlights get visually restored here
        if (!h.parentId && h.sourceTurnIndex > 0 && h.responseHTML) {
          restorable.push(h);
        }
      }

      if (allTurnIndices.length === 0 && restorable.length === 0) return;

      // Restore shorter (inner) highlights first so that when longer
      // (outer) highlights restore, the filter in highlightRange can
      // detect the inner and wrap around it instead of covering it.
      restorable.sort(function (a, b) {
        return (a.text || "").length - (b.text || "").length;
      });

      var attempts = 0;
      var maxAttempts = 30;
      var remaining = restorable.slice();
      var turnsRemaining = allTurnIndices.slice();

      function tryRestore() {
        // Hide all Q&A turns (level-1 + chained, every attempt until found)
        var turnsStillRemaining = [];
        for (var ti = 0; ti < turnsRemaining.length; ti++) {
          var turn = document.querySelector(
            'article[data-testid="conversation-turn-' + turnsRemaining[ti] + '"]'
          );
          if (turn) {
            turn.classList.add("jr-hidden");
          } else {
            turnsStillRemaining.push(turnsRemaining[ti]);
          }
        }
        turnsRemaining = turnsStillRemaining;

        // Restore level-1 highlights visually
        var stillRemaining = [];
        for (var i = 0; i < remaining.length; i++) {
          var hl = remaining[i];

          if (st.completedHighlights.has(hl.id)) continue;

          var sourceArticle = document.querySelector(
            'article[data-testid="conversation-turn-' + hl.sourceTurnIndex + '"]'
          );
          if (!sourceArticle) {
            stillRemaining.push(hl);
            continue;
          }

          var markdown = sourceArticle.querySelector(S.responseContent);
          if (!markdown) {
            stillRemaining.push(hl);
            continue;
          }

          var contentContainer = sourceArticle.parentElement;
          if (!JR.restoreHighlightInElement(markdown, hl, contentContainer)) {
            // Retry on next attempt — DOM may not be settled yet
            stillRemaining.push(hl);
            continue;
          }
        }

        remaining = stillRemaining;
        attempts++;

        JR.updateNavWidget();

        if ((remaining.length > 0 || turnsRemaining.length > 0) && attempts < maxAttempts) {
          st.restoreTimer = setTimeout(tryRestore, 500);
        }
      }

      tryRestore();
    });
  };
})();

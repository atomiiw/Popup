// highlight.js — Highlight creation, removal, and restoration
(function () {
  "use strict";

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
      var displayCache = new Map(); // cache getComputedStyle results per element
      while ((node = walker.nextNode())) {
        if (range.intersectsNode(node)) {
          // Skip whitespace-only text nodes between block elements
          // (they're layout-invisible; wrapping them in spans disrupts spacing)
          if (/^\s*$/.test(node.nodeValue)) {
            var parentEl = node.parentElement;
            if (parentEl) {
              var pd = displayCache.get(parentEl);
              if (pd === undefined) {
                pd = getComputedStyle(parentEl).display;
                displayCache.set(parentEl, pd);
              }
              if (pd !== "inline" && pd !== "inline-block") continue;
            }
          }
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
          var doneAncestor = textNodes[fi].parentElement && textNodes[fi].parentElement.closest(".jr-source-highlight-done");
          if (!doneAncestor) {
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
    } catch (e) {
      console.warn("[Popup] highlightRange failed:", e);
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
   * Remove all source highlight spans and restore original DOM.
   */
  JR.removeSourceHighlight = function () {
    for (var i = 0; i < st.activeSourceHighlights.length; i++) {
      var span = st.activeSourceHighlights[i];
      if (span._jrReplyAnchor) continue; // don't unwrap reply-to-all buttons
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
   * Turn stored/in-memory item data into the entry shape used everywhere.
   */
  function makeEntry(hlKey, hl, wrappers, contentContainer) {
    return {
      quoteId: hlKey,
      spans: wrappers,
      responseHTML: hl.responseHTML,
      text: hl.text,
      sentence: hl.sentence || null,
      blockTypes: hl.blockTypes || null,
      question: hl.question || null,
      color: hl.color || null,
      contentContainer: contentContainer,
      parentId: hl.parentId || null,
      parentItemId: hl.parentItemId || null,
      sourceTurnKey: hl.sourceTurnKey || null,
      wholeResponse: !!hl.wholeResponse,
      items: hl.items || [{ id: hl.id, question: hl.question || null, responseHTML: hl.responseHTML, turnKeys: hl.turnKeys || [] }],
      activeItemIndex: hl.activeItemIndex != null ? hl.activeItemIndex : 0,
    };
  }

  /**
   * Restore a single highlight by text-matching within a root element.
   * Shared by level-1 restore (turn mounted) and createPopup with completedId
   * (chained highlights inside a popup response).
   *
   * @param {Element} root - DOM element to search for the text
   * @param {object} hl - Highlight data (quoteId, text, color, parentId, items, ...)
   * @param {Element} contentContainer
   */
  JR.restoreHighlightInElement = function (root, hl, contentContainer) {
    var hlKey = hl.quoteId || hl.id;
    var range = JR.findTextRange(root, hl.text);
    if (!range) return false;
    var wrappers = JR.highlightRange(range);
    if (wrappers.length === 0) return false;
    for (var k = 0; k < wrappers.length; k++) {
      wrappers[k].setAttribute("data-jr-highlight-id", hlKey);
      wrappers[k].classList.add("jr-source-highlight-done");
    }
    var existing = st.completedHighlights.get(hlKey);
    if (existing) {
      // Re-applied after ChatGPT remounted the turn: keep the entry, swap in the new spans.
      existing.spans = wrappers;
      existing.contentContainer = contentContainer;
    } else {
      st.completedHighlights.set(hlKey, makeEntry(hlKey, hl, wrappers, contentContainer));
    }
    return true;
  };

  // --- Level-1 restore (event-driven) ---
  // ChatGPT virtualizes the thread: a turn's DOM exists only while it is near
  // the viewport and is rebuilt from scratch when scrolled back, dropping our
  // spans. JR.reapplyHighlights() runs whenever turns mount (qa-content.js
  // observer) and re-wraps any level-1 highlight whose source turn is present.

  var pendingL1 = [];   // grouped highlights whose source turn hasn't been seen yet
  var restoreGen = 0;

  JR.pendingRestoreCount = function () { return pendingL1.length; };

  /** Fill an item's content from JR.qa (cache or mounted turn). Returns true if filled. */
  function fillFromQA(item) {
    if (item.responseHTML !== "__LOADING__") return false;
    var c = JR.qa.get(item.turnKeys);
    if (!c) return false;
    item.responseHTML = c.responseHTML;
    if (c.question) item.question = c.question;
    if (c.sentence) item.sentence = c.sentence;
    return true;
  }

  function syncActive(q) {
    var it = q.items[q.activeItemIndex] || q.items[q.items.length - 1];
    if (!it) return;
    q.question = it.question;
    q.responseHTML = it.responseHTML;
    if (it.sentence) q.sentence = it.sentence;
  }

  /** Group stored version records by quoteId. */
  function groupByQuote(records) {
    var map = {};
    records.forEach(function (r) {
      var q = map[r.quoteId];
      if (!q) {
        q = map[r.quoteId] = {
          quoteId: r.quoteId, text: r.text, color: r.color, parentId: r.parentId,
          parentItemId: r.parentItemId, sourceTurnKey: r.sourceTurnKey, wholeResponse: r.wholeResponse,
          items: [], activeItemIndex: -1, sentence: null, blockTypes: null, question: null, responseHTML: null,
        };
      }
      var item = { id: r.id, question: r.question || null, responseHTML: r.responseHTML, turnKeys: r.turnKeys, legacy: r.legacy, createdAt: r.createdAt };
      fillFromQA(item);
      q.items.push(item);
      if (r.active) { q.activeItemIndex = q.items.length - 1; q.color = r.color; }
      if (!q.sourceTurnKey && r.sourceTurnKey) q.sourceTurnKey = r.sourceTurnKey;
    });
    Object.keys(map).forEach(function (k) {
      var q = map[k];
      if (q.activeItemIndex < 0) q.activeItemIndex = q.items.length - 1;
      syncActive(q);
    });
    return map;
  }

  /** Assistant markdown roots to search for a highlight's text. */
  function rootsFor(q) {
    if (q.sourceTurnKey) {
      var turn = JR.site.findTurnByKey(q.sourceTurnKey);
      return turn ? JR.site.assistantBodies(turn) : [];
    }
    // Migrated data has no turn key yet: look in every mounted answer, except
    // Popup Q&A answers (they often quote the highlighted text themselves).
    var roots = [];
    JR.site.turns().forEach(function (t) {
      if (st.hiddenTurnKeys.has(JR.site.turnKey(t))) return;
      var ut = JR.site.userText(t);
      if (ut && JR.isPopupMessage(ut)) return;
      roots = roots.concat(JR.site.assistantBodies(t));
    });
    return roots;
  }

  function tryRestoreL1(q) {
    var roots = rootsFor(q);
    for (var i = 0; i < roots.length; i++) {
      var turn = JR.site.turnOf(roots[i]);
      if (JR.restoreHighlightInElement(roots[i], q, JR.site.popupHost(turn))) {
        if (!q.sourceTurnKey) {
          var key = JR.site.turnKey(turn);
          q.sourceTurnKey = key;
          var entry = st.completedHighlights.get(q.quoteId);
          if (entry) entry.sourceTurnKey = key;
          q.items.forEach(function (it) { updateHighlightFields(it.id, { sourceTurnKey: key }); });
        }
        return true;
      }
    }
    return false;
  }

  /**
   * Re-wrap level-1 highlights whose source turn is mounted but whose spans
   * are missing (first load, or ChatGPT rebuilt the turn after a scroll).
   */
  JR.reapplyHighlights = function () {
    if (JR.perf) JR.perf.count("reapplyHighlights");
    var changed = false;

    // Entries we already know, whose spans ChatGPT threw away.
    st.completedHighlights.forEach(function (entry, qid) {
      if (entry.parentId || entry.wholeResponse || !entry.sourceTurnKey) return;
      if (entry.spans.length && entry.spans[0].isConnected) return;
      if (!JR.site.findTurnByKey(entry.sourceTurnKey)) return;
      if (tryRestoreL1(entry)) changed = true;
    });

    // Highlights from storage not restored yet. Shorter (inner) ones first so a
    // longer (outer) one can wrap around them.
    if (pendingL1.length) {
      var still = [];
      pendingL1.sort(function (a, b) { return (a.text || "").length - (b.text || "").length; });
      pendingL1.forEach(function (q) {
        if (st.completedHighlights.has(q.quoteId)) return;
        if (tryRestoreL1(q)) changed = true;
        else still.push(q);
      });
      pendingL1 = still;
    }

    if (changed) {
      if (st.activeHighlightId) JR.syncHighlightActive(st.activeHighlightId);
      JR.updateNavWidget();
    }
  };

  /**
   * Restore saved highlights for the current conversation: hide its Q&A turns
   * (CSS rules by turn key) and queue level-1 highlights for re-wrapping.
   */
  JR.restoreHighlights = function () {
    var gen = ++restoreGen;
    var url = location.href;
    pendingL1 = [];
    st.restoreReady = false; // qa-content's self-heal waits for this (it needs the stored items)

    getHiddenTurnKeys(url).then(function (keys) {
      if (gen !== restoreGen) return;
      JR.hideTurnKeys(keys);
    });

    getHighlightsByUrl(url).then(function (records) {
      if (gen !== restoreGen) return;
      var map = groupByQuote(records);
      Object.keys(map).forEach(function (qid) {
        var q = map[qid];
        if (!q.parentId && !q.wholeResponse) pendingL1.push(q);
      });
      st.restoreReady = true;
      JR.watchTurnMounts();
      JR.reapplyHighlights();
      JR.recheckTurns(); // run the mount pass (self-heal / adoption) now that items are known
      readBackFromConversation(records, gen);
    });
  };

  /**
   * Answers whose turns aren't in the DOM: read them from ChatGPT's conversation
   * data (JR.qa.ensure). Items with no turn key yet (saved before the redesign,
   * or whose turn never mounted) are matched to Popup questions found there.
   */
  function readBackFromConversation(records, gen) {
    var loadingKeys = [];
    var unlinked = false;
    records.forEach(function (r) {
      if (!(r.turnKeys || []).length) { unlinked = true; return; }
      if (r.responseHTML === "__LOADING__") loadingKeys = loadingKeys.concat(r.turnKeys);
    });
    var missing = loadingKeys.filter(function (k) { return !JR.qa.get([k]); });
    if (missing.length) JR.qa.ensure(missing);
    if (!unlinked) return;
    JR.qa.popupTurnsFromApi().then(function (turns) {
      if (gen !== restoreGen) return;
      var linked = new Set();
      records.forEach(function (r) { (r.turnKeys || []).forEach(function (k) { linked.add(k); }); });
      turns.forEach(function (t) {
        if (linked.has(t.turnKey)) return;
        // A Popup question nothing points to: keep it out of the main chat, and
        // link it to the item with the same highlighted text, if any.
        JR.hideTurnKeys([t.turnKey]);
        addDeletedTurns(location.href, [t.turnKey]);
        JR.adoptPopupTurn(t.turnKey, t.parsed);
      });
    });
  }

  /**
   * Content of hidden Q&A turns became available (turn mounted): fill entries
   * that were showing "loading", and refresh the open popup if it is one of them.
   */
  JR.onQAContentLoaded = function (turnKeys) {
    var refresh = null;
    st.completedHighlights.forEach(function (entry, qid) {
      var touched = false;
      (entry.items || []).forEach(function (it) {
        if (it.responseHTML !== "__LOADING__") return;
        if (!(it.turnKeys || []).some(function (k) { return turnKeys.indexOf(k) !== -1; })) return;
        if (fillFromQA(it)) touched = true;
      });
      if (touched) {
        syncActive(entry);
        if (st.activePopup && st.activePopup.isConnected && st.activeHighlightId === qid) refresh = qid;
      }
    });
    pendingL1.forEach(function (q) {
      q.items.forEach(function (it) {
        if ((it.turnKeys || []).some(function (k) { return turnKeys.indexOf(k) !== -1; })) fillFromQA(it);
      });
      syncActive(q);
    });
    // Don't rebuild under the user while they're editing the question.
    if (refresh && !st.activePopup.querySelector(".jr-popup-question--editing")) {
      JR.rebuildPopupAfterEdit(st.activePopup, refresh);
    }
  };

  /**
   * A Popup Q&A turn showed up that no stored item points to: data saved before
   * ChatGPT's redesign, or a send whose turn was never mounted while it was
   * answered (the item then shows "failed"). Link it to the stored item with the
   * same highlighted text (any nesting level), oldest unlinked first; reply-to-all
   * questions carry no quote and match reply-to-all items.
   */
  var claimed = new Set(); // record ids already being linked (adoption is async)

  function findInMemory(id) {
    var hit = null;
    st.completedHighlights.forEach(function (entry) {
      (entry.items || []).forEach(function (it) { if (it.id === id) hit = { entry: entry, item: it }; });
    });
    pendingL1.forEach(function (q) {
      q.items.forEach(function (it) { if (it.id === id) hit = { entry: q, item: it }; });
    });
    return hit;
  }

  JR.adoptPopupTurn = function (turnKey, parsed) {
    if (!parsed) return;
    getHighlightsByUrl().then(function (records) {
      if (records.some(function (r) { return (r.turnKeys || []).indexOf(turnKey) !== -1; })) return;
      var cands = records.filter(function (r) {
        if ((r.turnKeys || []).length || claimed.has(r.id)) return false;
        return parsed.wholeResponse ? r.wholeResponse : (!r.wholeResponse && r.text === parsed.text);
      });
      if (!cands.length) return;
      cands.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
      var rec = cands[0];
      claimed.add(rec.id);
      updateHighlightFields(rec.id, { turnKeys: [turnKey], responseHTML: "__LOADING__" });

      JR.qa.ensure([turnKey]); // read the answer (DOM cache or conversation data)
      var mem = findInMemory(rec.id);
      if (!mem) return; // not loaded in this session; the stored key is enough
      mem.item.turnKeys = [turnKey];
      if (mem.item.responseHTML === "__TIMEOUT__" || JR.isPlaceholderHTML(mem.item.responseHTML)) {
        mem.item.responseHTML = "__LOADING__";
        fillFromQA(mem.item);
        syncActive(mem.entry);
        var qid = mem.entry.quoteId;
        if (st.activePopup && st.activePopup.isConnected && st.activeHighlightId === qid &&
            !st.activePopup.querySelector(".jr-popup-question--editing")) {
          JR.rebuildPopupAfterEdit(st.activePopup, qid);
        }
      }
    });
  };
})();

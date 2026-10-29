// highlight.js — Highlight creation, removal, and restoration
(function () {
  "use strict";

  var st = JR.state;

  // --- Highlights where a span can't go -------------------------------------
  // SVG text (charts) does not draw HTML spans, and CodeMirror (code blocks)
  // removes them. There the text is painted with the CSS Custom Highlight API,
  // and one transparent proxy span per line sits over it: it carries the usual
  // classes, takes clicks and hover, and gives popups their position, so the
  // rest of Popup treats it like any other highlight span.
  var proxyGroups = new Set(); // { range, zone, host, text, proxies }
  var watchedHosts = new WeakSet();

  function zoneOf(node) {
    var el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    return el && el.closest ? el.closest(JR.site.noWrapSelector) : null;
  }

  function paintProxyRanges() {
    if (!window.CSS || !CSS.highlights) return;
    var h = new Highlight();
    proxyGroups.forEach(function (g) { if (!g.paint) h.add(g.range); });
    CSS.highlights.set("jr-mark", h);
  }

  /** Client rects of a range, merged per line. */
  function lineRects(range) {
    var out = [];
    Array.prototype.forEach.call(range.getClientRects(), function (r) {
      if (!r.width || !r.height) return;
      var last = out[out.length - 1];
      if (last && Math.abs(last.top - r.top) < 2 && Math.abs(last.bottom - r.bottom) < 2) {
        last.left = Math.min(last.left, r.left); last.right = Math.max(last.right, r.right);
      } else {
        out.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
      }
    });
    return out;
  }

  // The Highlight API can't recolour SVG text (only its background), and text in a
  // highlight is always white (dark in dark mode). So in charts each selected label
  // gets its own proxy that paints the highlight itself: mark background, and the
  // label's characters drawn by CSS (data-jr-text) in the mark text colour.
  function svgPieces(range) {
    var out = [], root = range.commonAncestorContainer, n;
    var walker = document.createTreeWalker(root.nodeType === Node.TEXT_NODE ? root.parentNode : root, NodeFilter.SHOW_TEXT, null);
    while ((n = walker.nextNode())) {
      if (!range.intersectsNode(n)) continue;
      var r = document.createRange();
      r.setStart(n, n === range.startContainer ? range.startOffset : 0);
      r.setEnd(n, n === range.endContainer ? range.endOffset : n.data.length);
      var b = r.getBoundingClientRect();
      if (r.toString().trim() && b.width) out.push({ left: b.left, right: b.right, top: b.top, bottom: b.bottom, text: r.toString(), el: n.parentElement });
    }
    return out;
  }

  function proxyBoxes(g) { return g.paint ? svgPieces(g.range) : lineRects(g.range); }

  function layoutProxies(g) {
    if (!g.range.startContainer.isConnected) { // the editor or chart rebuilt its text
      var r = JR.findTextRange(g.host, g.text, 0);
      if (r) g.range = r;
    }
    var box = g.host.getBoundingClientRect(), rects = proxyBoxes(g);
    g.proxies.forEach(function (p, i) {
      var r = rects[i] || { left: box.left, right: box.left, top: box.top, bottom: box.top };
      p.style.setProperty("--jr-proxy-x", (r.left - box.left) + "px");
      p.style.setProperty("--jr-proxy-y", (r.top - box.top) + "px");
      p.style.setProperty("--jr-proxy-w", (r.right - r.left) + "px");
      p.style.setProperty("--jr-proxy-h", (r.bottom - r.top) + "px");
      if (r.el) {
        var cs = getComputedStyle(r.el);
        p.setAttribute("data-jr-text", r.text);
        p.style.setProperty("--jr-proxy-font", cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily);
      }
    });
  }

  function relayoutAll() {
    proxyGroups.forEach(function (g) {
      if (g.proxies.some(function (p) { return p.isConnected; })) layoutProxies(g);
      else proxyGroups.delete(g); // its widget was replaced
    });
    paintProxyRanges();
  }
  var relayoutQueued = false;
  function queueRelayout() {
    if (relayoutQueued) return;
    relayoutQueued = true;
    requestAnimationFrame(function () { relayoutQueued = false; relayoutAll(); });
  }
  window.addEventListener("resize", queueRelayout);
  // Scrolling inside a code block or chart moves the text but not the proxies
  document.addEventListener("scroll", function (e) {
    var inside = false;
    proxyGroups.forEach(function (g) { if (!inside && e.target.nodeType === 1 && g.host.contains(e.target)) inside = true; });
    if (inside) queueRelayout();
  }, true);

  function watchHost(host) {
    if (watchedHosts.has(host)) return;
    watchedHosts.add(host);
    // A proxy removed like any span (dismiss, delete): stop painting its text
    new MutationObserver(function () {
      proxyGroups.forEach(function (g) {
        if (g.host === host && !g.proxies.some(function (p) { return p.isConnected; })) proxyGroups.delete(g);
      });
      paintProxyRanges();
    }).observe(host, { childList: true });
    if (window.ResizeObserver) new ResizeObserver(queueRelayout).observe(host);
  }

  function makeProxies(range, zone) {
    var host = zone.closest(JR.site.noWrapHostSelector) || zone.parentElement;
    var g = { range: range.cloneRange(), zone: zone, host: host, text: range.toString(), proxies: [],
      paint: zone.namespaceURI === "http://www.w3.org/2000/svg" };
    proxyBoxes(g).forEach(function () {
      var p = document.createElement("span");
      p.className = "jr-source-highlight jr-hl-proxy" + (g.paint ? " jr-hl-paint" : "");
      p._jrProxyGroup = g;
      g.proxies.push(p);
    });
    if (!g.proxies.length) return [];
    host.classList.add("jr-proxy-host");
    g.proxies.forEach(function (p) { host.appendChild(p); });
    proxyGroups.add(g);
    watchHost(host);
    layoutProxies(g);
    paintProxyRanges();
    return g.proxies;
  }

  /** The part of range inside zone. */
  function clipTo(range, zone) {
    var r = document.createRange();
    r.selectNodeContents(zone);
    if (range.compareBoundaryPoints(Range.START_TO_START, r) > 0) r.setStart(range.startContainer, range.startOffset);
    if (range.compareBoundaryPoints(Range.END_TO_END, r) < 0) r.setEnd(range.endContainer, range.endOffset);
    return r;
  }

  /** A highlight span's text as a Range (a proxy's: the text it stands over). */
  JR.spanRange = function (span) {
    if (span._jrProxyGroup) return span._jrProxyGroup.range.cloneRange();
    var r = document.createRange();
    r.selectNodeContents(span);
    return r;
  };

  /** First text node of a highlight span (a proxy's: of the text it stands over). */
  JR.spanTextNode = function (span) {
    if (!span._jrProxyGroup) return span.firstChild;
    var r = span._jrProxyGroup.range, n = r.startContainer;
    return n.nodeType === Node.TEXT_NODE ? n : (n.childNodes[r.startOffset] || n);
  };

  /** Spans in a range plus proxies for its parts inside no-span zones, in text order. */
  function highlightWithZones(range, zones) {
    var out = [];
    zones.forEach(function (z) { out = out.concat(makeProxies(clipTo(range, z), z)); });
    out = out.concat(wrapRange(range, true));
    return out.sort(function (a, b) {
      var na = JR.spanTextNode(a) || a, nb = JR.spanTextNode(b) || b;
      return na === nb ? 0 : (na.compareDocumentPosition(nb) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    });
  }


  /** No-span zones (SVG text, CodeMirror) the range has text in. */
  function zonesIn(range) {
    var zones = [], root = range.commonAncestorContainer, z = zoneOf(root);
    if (z) return [z];
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), n;
    while ((n = walker.nextNode())) {
      if (!range.intersectsNode(n) || !(z = zoneOf(n))) continue;
      if (zones.indexOf(z) === -1) zones.push(z);
    }
    return zones;
  }

  /**
   * Highlight a range: its text nodes wrapped in <span class="jr-source-highlight">,
   * and proxies over its text in SVG / CodeMirror (see above).
   * Returns an array of all wrapper spans created.
   */
  JR.highlightRange = function (range) {
    if (!range || range.collapsed) {
      console.warn("[JR] highlightRange: range is", range ? "collapsed" : "null");
      return [];
    }
    var zones = zonesIn(range);
    return zones.length ? highlightWithZones(range, zones) : wrapRange(range, false);
  };

  /** Wrap a range's text nodes in spans (skipZones: leave text in no-span zones alone). */
  function wrapRange(range, skipZones) {
    var wrappers = [];
    try {
      var startNode = range.startContainer;
      var endNode = range.endContainer;
      var commonAncestor = range.commonAncestorContainer;

      var startOffset = range.startOffset;
      var endOffset = range.endOffset;

      // Single text node
      if (startNode === endNode && startNode.nodeType === Node.TEXT_NODE) {
        if (skipZones && zoneOf(startNode)) return wrappers;
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
        if (range.intersectsNode(node) && !JR.isHiddenMath(node) && !(skipZones && zoneOf(node))) {
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
  }

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
    var first = JR.spanRange(st.activeSourceHighlights[0]);
    var last = JR.spanRange(st.activeSourceHighlights[st.activeSourceHighlights.length - 1]);
    var range = document.createRange();
    range.setStart(first.startContainer, first.startOffset);
    range.setEnd(last.endContainer, last.endOffset);
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
      nth: hl.nth || 0,
      sentence: hl.sentence || null,
      blockTypes: hl.blockTypes || null,
      question: hl.question || null,
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
   * @param {object} hl - Highlight data (quoteId, text, nth, parentId, items, ...)
   * @param {Element} contentContainer
   */
  JR.restoreHighlightInElement = function (root, hl, contentContainer) {
    var hlKey = hl.quoteId || hl.id;
    var range = JR.findTextRange(root, hl.text, hl.nth || 0);
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

  /** Level-1 highlights of this conversation not restored yet (turn not mounted). */
  JR.pendingL1Quotes = function () { return pendingL1.slice(); };

  /** Fill an item's content from JR.qa (cache or mounted turn). Returns true if filled. */
  var fillFromQA = JR.fillFromQA = function (item) {
    if (item.responseHTML !== "__LOADING__") return false;
    var c = JR.qa.get(item.turnKeys);
    if (!c) return false;
    item.responseHTML = c.responseHTML;
    if (c.question) item.question = c.question;
    if (c.sentence) item.sentence = c.sentence;
    return true;
  };

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
          quoteId: r.quoteId, text: r.text, nth: r.nth || 0, parentId: r.parentId,
          parentItemId: r.parentItemId, sourceTurnKey: r.sourceTurnKey, wholeResponse: r.wholeResponse,
          items: [], activeItemIndex: -1, sentence: null, blockTypes: null, question: null, responseHTML: null,
        };
      }
      var item = { id: r.id, question: r.question || null, responseHTML: r.responseHTML, turnKeys: r.turnKeys, createdAt: r.createdAt };
      fillFromQA(item);
      q.items.push(item);
      if (r.active) q.activeItemIndex = q.items.length - 1;
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

  // Text matching is the expensive part of a mount pass. If a highlight's text
  // wasn't found in a rendered answer, don't search that same element again on
  // every later mount (ChatGPT rebuilds the element when it re-renders it).
  // The current renderer fills an answer element after it mounts: a miss only
  // counts while the answer's text is unchanged.
  var noMatch = new WeakMap(); // answer root element → { len: its text length then, ids: Set of quoteIds not found }

  function tryRestoreL1(q) {
    var roots = rootsFor(q);
    for (var i = 0; i < roots.length; i++) {
      var len = roots[i].textContent.length;
      var missed = noMatch.get(roots[i]);
      if (missed && missed.len !== len) { noMatch.delete(roots[i]); missed = null; }
      if (missed && missed.ids.has(q.quoteId)) continue;
      var turn = JR.site.turnOf(roots[i]);
      if (!JR.restoreHighlightInElement(roots[i], q, JR.site.popupHost(turn))) {
        if (!missed) noMatch.set(roots[i], missed = { len: len, ids: new Set() });
        missed.ids.add(q.quoteId);
        continue;
      }
      if (!q.sourceTurnKey) {
        var key = JR.site.turnKey(turn);
        q.sourceTurnKey = key;
        var entry = st.completedHighlights.get(q.quoteId);
        if (entry) entry.sourceTurnKey = key;
        q.items.forEach(function (it) { updateHighlightFields(it.id, { sourceTurnKey: key }); });
      }
      return true;
    }
    return false;
  }

  /**
   * Re-wrap level-1 highlights whose source turn is mounted but whose spans
   * are missing (first load, or ChatGPT rebuilt the turn after a scroll).
   */
  // Re-wrapping text in highlight spans forces layout; doing it in the same
  // frame as a scroll made scrolling stutter (up to ~170 ms per mount). Run it
  // in idle time instead, a few ms per slice, continuing in the next idle slice.
  var reapplyQueued = false;
  var whenIdle = window.requestIdleCallback
    ? function (fn) { window.requestIdleCallback(fn, { timeout: 500 }); }
    : function (fn) { setTimeout(function () { fn({ timeRemaining: function () { return 8; }, didTimeout: true }); }, 16); };

  JR.reapplyHighlights = function () {
    if (reapplyQueued) return;
    reapplyQueued = true;
    whenIdle(runReapply);
  };

  function runReapply(deadline) {
    reapplyQueued = false;
    if (JR.perf) JR.perf.count("reapplyHighlights");
    var t0 = performance.now();

    // Entries we already know, whose spans ChatGPT threw away, then highlights
    // from storage not restored yet (shorter/inner ones first so a longer/outer
    // one can wrap around them). Only those whose turn is in the DOM now.
    var work = [];
    st.completedHighlights.forEach(function (entry) {
      if (entry.parentId || entry.wholeResponse || !entry.sourceTurnKey) return;
      if (entry.spans.length && entry.spans[0].isConnected) return;
      if (JR.site.findTurnByKey(entry.sourceTurnKey)) work.push(entry);
    });
    pendingL1.sort(function (a, b) { return (a.text || "").length - (b.text || "").length; });
    pendingL1.forEach(function (q) {
      if (!q.sourceTurnKey || JR.site.findTurnByKey(q.sourceTurnKey)) work.push(q);
    });

    var changed = false;
    for (var i = 0; i < work.length; i++) {
      if (i > 0 && !deadline.didTimeout && deadline.timeRemaining() < 3) {
        JR.reapplyHighlights(); // out of idle time: continue in the next slice
        break;
      }
      var q = work[i];
      if (pendingL1.indexOf(q) !== -1 && st.completedHighlights.has(q.quoteId)) continue;
      if (tryRestoreL1(q)) changed = true;
    }
    pendingL1 = pendingL1.filter(function (q) { return !st.completedHighlights.has(q.quoteId); });

    if (changed) {
      if (st.activeHighlightId) JR.syncHighlightActive(st.activeHighlightId);
      JR.updateNavWidget();
    }
    if (JR.perf) JR.perf.time("reapplySlice", Math.round((performance.now() - t0) * 10) / 10);
  }

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

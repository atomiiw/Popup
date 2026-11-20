// popup-helpers.js — Popup positioning, resizing, rendering helpers
(function () {
  "use strict";

  var st = JR.state;
  var NAV_WIDGET_GAP = 12; // px gap between popup right edge and nav widget

  /** Max right edge (in viewport px) a popup may reach. [LAYOUT-LOCKED] */
  function getPopupMaxRight() { // [LAYOUT-LOCKED]
    if (st.navWidget && st.navWidget.isConnected && st.navWidget.style.display !== "none") {
      return st.navWidget.getBoundingClientRect().left - NAV_WIDGET_GAP;
    }
    // When right sidebar is open, use the chat column's right edge
    var chatCol = JR.site.chatColumn();
    if (chatCol) {
      var cr = chatCol.getBoundingClientRect();
      if (window.innerWidth - cr.right > 200) {
        return cr.right - 20;
      }
    }
    return window.innerWidth - 8;
  }
  JR.getPopupMaxRight = getPopupMaxRight;

  /** True when ChatGPT's right sidebar (research/canvas) is visible. [LAYOUT-LOCKED] */
  JR.isRightSidebarOpen = function () { // [LAYOUT-LOCKED]
    if (JR.site.navRight && JR.site.navRight() != null) return false; // a panel that is always there (Claude Code)
    var chatCol = JR.site.chatColumn();
    if (!chatCol) return false;
    var rightGap = window.innerWidth - chatCol.getBoundingClientRect().right;
    return rightGap > 200;
  };

  /** Min left edge (in viewport px) a popup may reach. */
  function getPopupMinLeft() {
    // Use the chat column's left edge — it shifts automatically
    // when the sidebar expands/collapses
    var chatCol = JR.site.chatColumn();
    if (chatCol) {
      var cr = chatCol.getBoundingClientRect();
      if (cr.left > 0) return cr.left + 20;
    }
    return 8;
  }
  JR.getPopupMinLeft = getPopupMinLeft;

  /** Clamp a popup left position (container-relative) within sidebar and nav widget boundaries. */
  function clampPopupLeft(left, popupW, containerRect, containerW) {
    var minLeftVp = getPopupMinLeft();
    var maxRightVp = getPopupMaxRight();
    var minLeft = minLeftVp - containerRect.left;
    var maxLeft = maxRightVp - containerRect.left - popupW;
    return Math.max(minLeft, Math.min(left, containerW - popupW - 8, maxLeft));
  }

  // Debug (URL contains #jr-poslog): every popup move with its inputs and caller, readable by DOM-only
  // test tools in #jr-poslog[data-json] (last 80)
  JR.posLog = function (fn, popup, info) {
    if (location.hash.indexOf("jr-poslog") === -1 || !popup) return;
    var el = document.getElementById("jr-poslog");
    if (!el) { el = document.createElement("div"); el.id = "jr-poslog"; el.hidden = true; document.body.appendChild(el); }
    var log = JSON.parse(el.getAttribute("data-json") || "[]");
    log.push({ t: Math.round(performance.now()), fn: fn, chained: !!popup._jrChained, active: popup === st.activePopup,
      top: popup.style.top, h: popup.offsetHeight, info: info, stack: (new Error().stack || "").split("\n").slice(2, 6).join(" | ") });
    el.setAttribute("data-json", JSON.stringify(log.slice(-80)));
  };

  /** The area under the quote that holds the attachments and the question (one scroll area, R17). */
  JR.askArea = function (upper) {
    var area = upper.querySelector(".jr-popup-ask");
    if (!area) {
      area = document.createElement("div");
      area.className = "jr-popup-ask";
      // The send menu is position: fixed (the area clips): put it under its send button when hovered.
      // Fixed is relative to the nearest contain/transform ancestor, not always the viewport (claude.ai: contain: layout),
      // so a 0×0 fixed probe at 0,0 gives that origin.
      var probe = document.createElement("div");
      probe.className = "jr-fixed-probe";
      area.addEventListener("mouseover", function (e) {
        var wrap = e.target.closest && e.target.closest(".jr-edit-send-wrapper");
        var menu = wrap && wrap.querySelector(".jr-send-mode-dropdown");
        if (!menu) return;
        var r = wrap.getBoundingClientRect(), o = probe.getBoundingClientRect();
        menu.style.left = (r.left + r.width / 2 - o.left) + "px";
        menu.style.top = (r.bottom + 4 - o.top) + "px";
      });
      upper.appendChild(area);
      upper.appendChild(probe); // outside the area: its :first-child rules stay as they are
    }
    return area;
  };

  JR.createLoadingDiv = function () {
    var div = document.createElement("div");
    div.className = "jr-popup-loading";
    div.textContent = "Loading\u2026"; // (user, 2026-11-18: not "Waiting for response…")
    return div;
  };

  /** Root of the answer (or popup response) a highlight sits in. */
  JR.quoteRoot = function (spans) {
    var anchor = spans && spans[0];
    if (!anchor || !anchor.isConnected) return null;
    return anchor.closest(".jr-popup-response") || JR.site.turnOf(anchor);
  };

  /**
   * Show formulas in the quote as they look on the page. The quote text has
   * each formula as TeX (\( … \)); where the highlighted answer is on the page,
   * that TeX is replaced by a copy of the rendered formula, marked on exactly
   * the characters this highlight covers. Then any plain text of `text` the TeX
   * quote could not mark (a selection of part of a formula plus some words) is
   * marked too.
   * shortcut: when inline code shows the same TeX as a formula in the same
   * sentence, the first occurrence gets the formula (LaTeX-tutorial answers only).
   */
  JR.renderQuoteMath = function (container, spans, text) {
    var root = JR.quoteRoot(spans);
    if (!root || container.textContent.indexOf("\\") === -1) return;
    var maths = Array.prototype.slice.call(root.querySelectorAll(JR.site.mathSelector));
    if (!maths.length) return;
    var texs = maths.map(JR.mathText);
    var used = [];
    function blockOf(el) {
      for (var e = el; e && e !== root; e = e.parentElement) if (JR.BLOCK_TAGS.has(e.tagName)) return e;
      return null;
    }
    // The formula with this TeX nearest to the highlight (the same text can appear twice).
    function pick(tex) {
      var best = -1, bestNear = false;
      for (var i = 0; i < maths.length; i++) {
        if (texs[i] !== tex || used.indexOf(i) !== -1) continue;
        var block = blockOf(maths[i]) || maths[i];
        var near = spans.some(function (sp) { return block.contains(sp); });
        if (best === -1 || (near && !bestNear)) { best = i; bestNear = near; }
      }
      if (best !== -1) used.push(best);
      return best === -1 ? null : maths[best];
    }
    // Copy a formula; only this highlight's spans become quote marks.
    function copyOf(math) {
      spans.forEach(function (sp) { sp.classList.add("jr-quote-own"); });
      var copy = math.cloneNode(true);
      spans.forEach(function (sp) { sp.classList.remove("jr-quote-own"); });
      Array.prototype.forEach.call(copy.querySelectorAll(".jr-source-highlight"), function (sp) {
        sp.className = sp.classList.contains("jr-quote-own") ? "jr-popup-mark" : "";
        sp.removeAttribute("data-jr-highlight-id");
      });
      return copy;
    }
    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    var textNodes = [], n;
    while ((n = walker.nextNode())) textNodes.push(n);
    textNodes.forEach(function (tn) {
      var re = /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g, m, last = 0, frag = null;
      while ((m = re.exec(tn.data))) {
        var math = pick(m[0]);
        if (!math) continue;
        frag = frag || document.createDocumentFragment();
        frag.appendChild(document.createTextNode(tn.data.slice(last, m.index)));
        frag.appendChild(copyOf(math));
        last = m.index + m[0].length;
      }
      if (!frag) return;
      frag.appendChild(document.createTextNode(tn.data.slice(last)));
      tn.parentNode.replaceChild(frag, tn);
    });
    if (text && !hasMarkOutsideMath(container)) markPlainText(container, text);
  };

  function hasMarkOutsideMath(container) {
    return Array.prototype.some.call(container.querySelectorAll(".jr-popup-mark"), function (mk) {
      return !mk.closest(JR.site.mathSelector);
    });
  }

  /** Mark the plain-text (non-formula) part of `text` in the quote's on-screen text. */
  function markPlainText(container, text) {
    var nodes = [], full = "";
    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null), n;
    while ((n = walker.nextNode())) {
      if (JR.isHiddenMath(n)) continue;
      nodes.push({ node: n, start: full.length });
      full += n.data;
    }
    var at = full.indexOf(text);
    if (at === -1) return;
    var end = at + text.length;
    nodes.forEach(function (e) {
      var a = Math.max(at, e.start) - e.start, b = Math.min(end, e.start + e.node.data.length) - e.start;
      if (a >= b || e.node.parentElement.closest(JR.site.mathSelector)) return;
      var mid = e.node.splitText(a);
      mid.splitText(b - a);
      var mark = document.createElement("span");
      mark.className = "jr-popup-mark";
      mid.parentNode.replaceChild(mark, mid);
      mark.appendChild(mid);
    });
  }

  /**
   * Render sentence context inside a container element.
   * Single-block: inline text with highlighted mark.
   * Multi-block (contains \n): renders a list preserving bullet structure.
   */
  JR.renderSentenceContext = function (container, sentence, text, blockTypes, hasMath) {
    var isMultiBlock = sentence.indexOf("\n") !== -1;

    var matchStart = -1;
    var matchLen = 0;
    var directIdx = sentence.indexOf(text);
    if (directIdx !== -1) {
      matchStart = directIdx;
      matchLen = text.length;
    } else {
      var normSentence = sentence.replace(/\s+/g, " ");
      var normText = text.replace(/\s+/g, " ");
      var normIdx = normSentence.indexOf(normText);
      if (normIdx !== -1) {
        matchStart = normIdx;
        matchLen = normText.length;
      }
    }
    // Part of a formula (e.g. one letter) is not marked in the TeX text: that
    // would cut the formula apart; JR.renderQuoteMath shows it marked inside
    // the copied formula instead.
    if (matchStart !== -1 && hasMath) {
      var texRe = /\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g, tm;
      while ((tm = texRe.exec(sentence))) {
        var tStart = tm.index, tEnd = tm.index + tm[0].length;
        var overlaps = matchStart < tEnd && matchStart + matchLen > tStart;
        var whole = matchStart <= tStart && matchStart + matchLen >= tEnd;
        if (overlaps && !whole) { matchStart = -1; break; }
      }
    }

    function appendTextWithBreaks(parent, str) {
      if (!str) return;
      var parts = str.split("\n");
      for (var p = 0; p < parts.length; p++) {
        if (p > 0) parent.appendChild(document.createElement("br"));
        if (parts[p]) parent.appendChild(document.createTextNode(parts[p]));
      }
    }

    function fillWithHighlight(el, blockText, blockStart, blockEnd, pills, bolds) {
      var hlStart = -1, hlEnd = -1;
      if (matchStart !== -1) {
        hlStart = Math.max(matchStart, blockStart) - blockStart;
        hlEnd = Math.min(matchStart + matchLen, blockEnd) - blockStart;
        if (hlStart >= hlEnd || hlStart < 0) { hlStart = -1; hlEnd = -1; }
      }

      var points = [0, blockText.length];
      if (hlStart >= 0) { points.push(hlStart); points.push(hlEnd); }
      if (pills) {
        for (var p = 0; p < pills.length; p++) {
          points.push(Math.max(0, pills[p].start));
          points.push(Math.min(blockText.length, pills[p].end));
        }
      }
      if (bolds) {
        for (var b = 0; b < bolds.length; b++) {
          points.push(Math.max(0, bolds[b].start));
          points.push(Math.min(blockText.length, bolds[b].end));
        }
      }
      points.sort(function (a, b) { return a - b; });
      var sorted = [points[0]];
      for (var s = 1; s < points.length; s++) {
        if (points[s] !== points[s - 1]) sorted.push(points[s]);
      }

      for (var i = 0; i < sorted.length - 1; i++) {
        var segStart = sorted[i];
        var segEnd = sorted[i + 1];
        if (segStart >= segEnd) continue;

        var segText = blockText.slice(segStart, segEnd);
        var isHL = (hlStart >= 0 && segStart >= hlStart && segEnd <= hlEnd);
        var isPill = false;
        if (pills) {
          for (var j = 0; j < pills.length; j++) {
            if (segStart >= pills[j].start && segEnd <= pills[j].end) { isPill = true; break; }
          }
        }
        var isBold = false;
        if (bolds) {
          for (var k = 0; k < bolds.length; k++) {
            if (segStart >= bolds[k].start && segEnd <= bolds[k].end) { isBold = true; break; }
          }
        }

        var content;
        if (isPill) {
          content = document.createElement("span");
          content.className = isHL ? "jr-popup-pill jr-popup-mark" : "jr-popup-pill";
          appendTextWithBreaks(content, segText);
        } else if (isHL) {
          content = document.createElement("span");
          content.className = "jr-popup-mark";
          appendTextWithBreaks(content, segText);
        } else {
          content = null;
        }

        if (isBold) {
          var strong = document.createElement("strong");
          if (content) {
            strong.appendChild(content);
          } else {
            appendTextWithBreaks(strong, segText);
          }
          el.appendChild(strong);
        } else if (content) {
          el.appendChild(content);
        } else {
          appendTextWithBreaks(el, segText);
        }
      }
    }

    if (!isMultiBlock) {
      var singleMeta = (blockTypes && blockTypes.length === 1) ? blockTypes[0] : null;
      var singlePills = singleMeta ? singleMeta.pills : null;
      var singleBolds = singleMeta ? singleMeta.bolds : null;
      var isBullet = singleMeta && singleMeta.tag === "LI";
      if (singleMeta && singleMeta.tag === "PRE") {
        var codeDiv = document.createElement("div");
        codeDiv.className = "jr-popup-context-block jr-popup-context-code";
        container.appendChild(codeDiv);
        container = codeDiv;
      }
      var hasSegments = (singlePills && singlePills.length > 0) || (singleBolds && singleBolds.length > 0);

      if (isBullet) {
        var listEl = document.createElement(singleMeta.listType || "ul");
        listEl.className = "jr-popup-context-list";
        if (singleMeta.listType === "ol" && singleMeta.listStart > 1) {
          listEl.setAttribute("start", singleMeta.listStart);
        }
        var li = document.createElement("li");
        fillWithHighlight(li, sentence, 0, sentence.length, singlePills, singleBolds);
        listEl.appendChild(li);
        container.appendChild(listEl);
      } else if (hasSegments) {
        fillWithHighlight(container, sentence, 0, sentence.length, singlePills, singleBolds);
      } else if (matchStart !== -1) {
        var before = sentence.slice(0, matchStart);
        var after = sentence.slice(matchStart + matchLen);
        if (before) container.appendChild(document.createTextNode(before));
        var mark = document.createElement("span");
        mark.className = "jr-popup-mark";
        mark.textContent = sentence.slice(matchStart, matchStart + matchLen);
        container.appendChild(mark);
        if (after) container.appendChild(document.createTextNode(after));
      } else {
        container.textContent = sentence;
      }
      return;
    }

    // Multi-block rendering
    var lines = sentence.split("\n");

    var blockList = [];
    var lineIdx = 0;
    if (blockTypes && blockTypes.length > 0) {
      for (var b = 0; b < blockTypes.length; b++) {
        var nLines = blockTypes[b].lineCount || 1;
        blockList.push({
          text: lines.slice(lineIdx, lineIdx + nLines).join("\n"),
          meta: blockTypes[b]
        });
        lineIdx += nLines;
      }
    }
    for (; lineIdx < lines.length; lineIdx++) {
      blockList.push({
        text: lines[lineIdx],
        meta: { tag: "P", depth: 0 }
      });
    }

    var minDepth = Infinity;
    for (var k = 0; k < blockList.length; k++) {
      var t = blockList[k].meta.tag;
      if ((t === "LI" || t === "LI_CONT") && blockList[k].meta.depth < minDepth) {
        minDepth = blockList[k].meta.depth;
      }
    }
    if (minDepth === Infinity) minDepth = 1;

    var pos = 0;
    var openList = null;
    var openListType = null;

    for (var i = 0; i < blockList.length; i++) {
      var block = blockList[i];
      var meta = block.meta;
      var blockStart = pos;
      var blockEnd = pos + block.text.length;

      if (meta.tag === "LI" || meta.tag === "LI_CONT") {
        var lt = meta.listType || "ul";
        if (openList && openListType !== lt) {
          container.appendChild(openList);
          openList = null;
        }
        if (!openList) {
          openList = document.createElement(lt);
          openList.className = "jr-popup-context-list";
          if (lt === "ol" && meta.listStart > 1) {
            openList.setAttribute("start", meta.listStart);
          }
          openListType = lt;
        }
        var li = document.createElement("li");
        var relDepth = meta.depth - minDepth;
        if (relDepth > 0) {
          li.classList.add("jr-depth-" + Math.min(relDepth, 2));
        }
        if (meta.tag === "LI_CONT") {
          li.classList.add("jr-li-cont");
        }
        fillWithHighlight(li, block.text, blockStart, blockEnd, meta.pills, meta.bolds);
        openList.appendChild(li);
      } else {
        if (openList) {
          container.appendChild(openList);
          openList = null;
          openListType = null;
        }
        var div = document.createElement("div");
        div.className = "jr-popup-context-block";
        if (/^H[1-6]$/.test(meta.tag)) {
          div.classList.add("jr-popup-context-heading");
        } else if (meta.tag === "PRE") {
          div.classList.add("jr-popup-context-code");
        }
        fillWithHighlight(div, block.text, blockStart, blockEnd, meta.pills, meta.bolds);
        container.appendChild(div);
      }

      pos = blockEnd + 1;
    }

    if (openList) {
      container.appendChild(openList);
    }
  };

  /**
   * Which side of the highlight a popup of height popupH opens on (user, 2026-11-20, again after ChatGPT): first the side
   * where it can be seen whole — the chat can scroll far enough to show it, not left behind the composer; only one does →
   * that one. Both do → the side with more room on screen now (high on screen → below, low → above; 2026-11-18). Neither →
   * below, no taller than the room there (capBelow). Below counts as fitting with room for at least the popup's least
   * height (40vh, the drag limit) — it is then no taller than that room; a popup that would make the page longer counts
   * no more room: past the chat's end it stays under the composer (Claude Code, 2026-11-20). The chat's reach is
   * measured without the popup in it (positionPopup).
   */
  JR.bestDirection = function (highlightRect, popupH, gap) {
    if (!highlightRect) return "below";
    var band = JR.site.visibleBand();
    var sc = JR.site.scrollContainer();
    var spaceAbove = highlightRect.top - band.top - gap;
    var spaceBelow = band.bottom - highlightRect.bottom - gap;
    var reachAbove = spaceAbove + (sc ? sc.scrollTop : 0);
    var reachBelow = spaceBelow + (sc ? Math.max(0, sc.scrollHeight - sc.scrollTop - sc.clientHeight) : 0);
    var fitsAbove = reachAbove >= popupH, fitsBelow = reachBelow >= Math.min(popupH, 40 * window.innerHeight / 100);
    if (fitsAbove !== fitsBelow) return fitsBelow ? "below" : "above";
    if (fitsAbove) return spaceBelow >= spaceAbove ? "below" : "above";
    return "below";
  };

  /**
   * Get the bounding rect of just the first or last line of highlight spans.
   * Spans on the same line share a similar top value (within 4px tolerance).
   */
  JR.getAdjacentLineRect = function (spans, direction) {
    if (!spans || spans.length === 0) return null;
    var rects = [];
    for (var i = 0; i < spans.length; i++) {
      // One box per line: a span that wraps has a bounding rect spanning both lines, whose middle is
      // nowhere near the highlight (R36e: the arrow pointed at the paragraph's middle)
      var lineBoxes = spans[i].getClientRects();
      for (var b = 0; b < lineBoxes.length; b++) {
        var r = lineBoxes[b];
        if (r.width === 0 && r.height === 0) continue;
        rects.push(r);
      }
    }
    if (rects.length === 0) return null;
    // Sort by top position
    rects.sort(function (a, b) { return a.top - b.top; });
    var refTop;
    if (direction === "above") {
      // Popup is above → adjacent line is the first (topmost) line
      refTop = rects[0].top;
    } else {
      // Popup is below → adjacent line is the last (bottommost) line
      refTop = rects[rects.length - 1].top;
    }
    // Collect all rects on the same line (within 4px tolerance)
    var top = Infinity, left = Infinity, bottom = -Infinity, right = -Infinity;
    for (var j = 0; j < rects.length; j++) {
      if (Math.abs(rects[j].top - refTop) <= 4) {
        if (rects[j].top < top) top = rects[j].top;
        if (rects[j].left < left) left = rects[j].left;
        if (rects[j].bottom > bottom) bottom = rects[j].bottom;
        if (rects[j].right > right) right = rects[j].right;
      }
    }
    // Sideways: the line holding most of the highlight (user, 2026-11-17: a one-character sliver next to the
    // popup must not pull the popup and arrow to it); up/down stays on the adjacent line (never covers the highlight)
    var widths = {};
    rects.forEach(function (r) { var k = Math.round(r.top); widths[k] = (widths[k] || 0) + r.width; });
    var longTop = Number(Object.keys(widths).sort(function (a, b) { return widths[b] - widths[a]; })[0]);
    if (Math.abs(longTop - refTop) > 4) {
      left = Infinity; right = -Infinity;
      for (var n = 0; n < rects.length; n++) {
        if (Math.abs(rects[n].top - longTop) <= 4) { left = Math.min(left, rects[n].left); right = Math.max(right, rects[n].right); }
      }
    }
    return { top: top, left: left, bottom: bottom, right: right, width: right - left, height: bottom - top };
  };

  /**
   * Update (or create) the arrow element on a popup, pointing toward the highlight.
   * @param {HTMLElement} popup
   * @param {DOMRect} highlightRect — bounding rect of the source highlight (viewport coords)
   * @param {DOMRect} containerRect — bounding rect of the content container (viewport coords)
   * @param {number} popupLeft — popup's CSS left value (px, relative to container)
   */
  JR.updateArrow = function (popup, highlightRect, containerRect, popupLeft) {
    var arrow = popup.querySelector(".jr-popup-arrow");
    if (!arrow) {
      arrow = document.createElement("div");
      arrow.className = "jr-popup-arrow";
      popup.appendChild(arrow);
    }
    arrow.classList.remove("jr-popup-arrow--up", "jr-popup-arrow--down", "jr-popup-arrow--lower");
    if (popup._jrLockedDirection === "above") {
      arrow.classList.add("jr-popup-arrow--down");
      // Down arrow touches whichever card is at the bottom
      var hasLower = popup.querySelector(".jr-popup-response, .jr-popup-loading");
      if (hasLower) arrow.classList.add("jr-popup-arrow--lower");
    } else {
      arrow.classList.add("jr-popup-arrow--up");
    }
    var halfArrow = 9;
    var highlightCenterX = highlightRect.left + highlightRect.width / 2;
    var offset = highlightCenterX - containerRect.left - popupLeft - halfArrow;
    var popupW = popup.offsetWidth;
    offset = Math.max(12, Math.min(offset, popupW - 30));
    arrow.style.left = offset + "px";
  };

  // A popup grows with its answer up to its max-height (styles.css), and an edit can bring
  // a longer answer: its side is chosen for that height so it never has to flip.
  function answerH(popup) {
    return parseFloat(getComputedStyle(popup).maxHeight) || popup.offsetHeight;
  }

  /**
   * Position the popup inside the content container.
   * Uses position: absolute relative to the container.
   */
  JR.positionPopup = function (popup, rect, contentContainer, forceDirection, spans) {
    // Batch layout reads: getBoundingClientRect + getComputedStyle share the same
    // forced layout, so checking position here avoids an extra layout pass.
    var containerRect = contentContainer.getBoundingClientRect();
    if (getComputedStyle(contentContainer).position === "static") {
      contentContainer.style.position = "relative";
    }
    contentContainer.style.zIndex = "0";
    var gap = 8;

    contentContainer.appendChild(popup);
    JR.watchUpper(popup); // before measuring: on a tiny window the height limit depends on it
    if (forceDirection === "above" || forceDirection === "below") popup._jrLockedDirection = forceDirection;
    else {
      var popupH = Math.max(popup.offsetHeight, answerH(popup));
      popup._jrLockedDirection = withoutPopup(popup, function () { return JR.bestDirection(rect, popupH, gap); });
    }
    placeAt(popup, rect, spans, containerRect);
    capBelow(popup, gap);
    JR.posLog("position", popup, { dir: popup._jrLockedDirection, rectTop: rect.top, cTop: containerRect.top, popupH: popup.offsetHeight });
  };

  /** A popup below a highlight near the end of a short chat: ChatGPT and DeepSeek clip what hangs past the end of their
   *  list, so the page can't scroll to it — its end sat behind the composer and its bottom edge (resize) was out of reach
   *  (user, 2026-11-20, DeepSeek's first sentence). It is no taller than the chat can still scroll to; it scrolls inside. */
  function capBelow(popup, gap) {
    popup.style.removeProperty("--jr-popup-cap");
    var sc = JR.site.scrollContainer();
    if (popup._jrLockedDirection !== "below" || !sc) return;
    var reach = withoutPopup(popup, function () {
      return JR.site.visibleBand().bottom + Math.max(0, sc.scrollHeight - sc.scrollTop - sc.clientHeight);
    });
    popup.style.setProperty("--jr-popup-cap", Math.floor(reach - popup.getBoundingClientRect().top - gap) + "px");
  }

  /** fn() measured with this popup out of the layout (never painted): the chat's own length, not one it makes longer. */
  function withoutPopup(popup, fn) {
    popup.classList.add("jr-popup--measure");
    try { return fn(); } finally { popup.classList.remove("jr-popup--measure"); }
  }




  /** Popup on its locked side of rect, centred on the highlight's line next to it. */
  function placeAt(popup, rect, spans, containerRect) {
    var direction = popup._jrLockedDirection, gap = 8;
    var popupW = popup.offsetWidth, popupH = popup.offsetHeight;
    var centerRect = (spans && spans.length && JR.getAdjacentLineRect(spans, direction)) || rect;
    var left = clampPopupLeft(centerRect.left - containerRect.left + centerRect.width / 2 - popupW / 2,
      popupW, containerRect, popup.parentElement.clientWidth);
    var top = direction === "above" ? rect.top - containerRect.top - popupH - gap : rect.bottom - containerRect.top + gap;
    popup.style.left = left + "px";
    popup.style.top = top + "px";
    // "above": height changes keep the bottom edge (the arrow) pinned to the highlight
    if (direction === "above") popup._jrBottomAnchor = top + popupH;
    JR.updateArrow(popup, centerRect, containerRect, left);
  }

  /**
   * Attach a ResizeObserver to an "above" popup so that when its height
   * changes (streaming, version switch, edit rebuild), the bottom edge
   * stays pinned to the highlight and the arrow doesn't drift.
   */
  JR.attachAboveAnchorObserver = function (popup) {
    if (typeof ResizeObserver === "undefined") return;
    var ro = new ResizeObserver(function () {
      if (popup._jrBottomAnchor == null) return;
      if (popup._jrResizing) return; // drag-resize already handles this
      var dir = popup._jrLockedDirection;
      if (dir !== "above") return;
      if (popup._jrGrowRaf) return; // growGently places it every frame
      if (popup.classList.contains("jr-popup--streaming")) return growGently(popup);
      var newH = popup.offsetHeight;
      popup.style.top = (popup._jrBottomAnchor - newH) + "px";
      JR.posLog("anchorObserver", popup, { anchor: popup._jrBottomAnchor, newH: newH });
    });
    ro.observe(popup);
    popup._jrAboveObserver = ro;
  };

  /**
   * An "above" popup that streams grew a whole line at once, moving everything in it up a line (the user's
   * "一抖一抖"). While it streams, its shown height eases towards its content's height every frame (30 % of
   * the gap) and its top moves with it, so the bottom and the arrow stay on the highlight; after it, auto again.
   */
  function growGently(popup) {
    var shown = popup._jrBottomAnchor - (parseFloat(popup.style.top) || 0); // the height before this line
    popup.classList.add("jr-popup--grow");
    (function frame() {
      if (!popup.isConnected || popup._jrResizing || popup._jrLockedDirection !== "above" || popup._jrBottomAnchor == null) return stopGrow(popup);
      popup.style.height = "";
      var target = popup.offsetHeight; // content height, within the popup's max-height
      shown = Math.abs(target - shown) < 0.5 ? target : shown + (target - shown) * 0.3;
      popup.style.height = shown + "px";
      popup.style.top = (popup._jrBottomAnchor - shown) + "px";
      popup.classList.toggle("jr-popup--grow-fill", shown < target); // the line still easing in isn't a scroll
      if (shown === target && !popup.classList.contains("jr-popup--streaming")) return stopGrow(popup);
      popup._jrGrowRaf = requestAnimationFrame(frame);
    })();
  }

  function stopGrow(popup) {
    cancelAnimationFrame(popup._jrGrowRaf);
    popup._jrGrowRaf = 0;
    popup.classList.remove("jr-popup--grow", "jr-popup--grow-fill");
    popup.style.height = "";
    if (popup.isConnected && popup._jrBottomAnchor != null && popup._jrLockedDirection === "above") {
      popup.style.top = (popup._jrBottomAnchor - popup.offsetHeight) + "px";
    }
  }


  /**
   * While an answer streams, and once when it is done, its end stays in view: the answer area scrolls to its end —
   * unless the user scrolled or clicked in it during this answer (their place is then theirs). Not while an
   * "above" popup is still easing a line in (growGently): that overflow isn't a reason to scroll.
   */
  JR.followAnswer = function (resp) {
    if (!resp._jrFollow) {
      resp._jrFollow = true;
      ["wheel", "touchstart", "pointerdown", "keydown"].forEach(function (t) {
        resp.addEventListener(t, function () { resp._jrUserScrolled = true; }, { passive: true });
      });
    }
    var popup = resp.closest(".jr-popup");
    if (resp._jrUserScrolled || (popup && popup.classList.contains("jr-popup--grow-fill"))) return;
    if (resp.scrollHeight - resp.clientHeight - resp.scrollTop > 1) resp.scrollTo({ top: resp.scrollHeight, behavior: "smooth" });
  };

  /**
   * A streaming answer types out one character after another (the user: like ChatGPT's code blocks), not in the
   * chunks it arrives in. The text not typed yet is in the "jr-untyped" CSS highlight (transparent, styles.css);
   * each frame types more — the more is waiting, the faster, so it never falls far behind. Called after every
   * change to the answer (covers new text before it paints); keeps typing across the rebuild when the answer is
   * done, and stops once everything is typed.
   */
  var untyped = null;
  JR.typeAnswer = function (popup) {
    if (!window.CSS || !CSS.highlights || !window.Highlight) return;
    if (!untyped) { untyped = new Highlight(); CSS.highlights.set("jr-untyped", untyped); }
    if (popup._jrTyped == null) {
      popup._jrTyped = 0;
      popup._jrUntyped = document.createRange();
      (function frame() {
        var left = coverUntyped(popup);
        if (left === 0 && !popup.classList.contains("jr-popup--streaming")) return stopTyping(popup);
        if (left < 0) return stopTyping(popup);
        popup._jrTyped += Math.ceil(left / 12);
        coverUntyped(popup);
        requestAnimationFrame(frame);
      })();
    } else coverUntyped(popup);
  };

  /** Hide what isn't typed yet; returns how many characters that is (-1: the popup is gone). */
  function coverUntyped(popup) {
    var resp = popup.isConnected && popup.querySelector(".jr-popup-response");
    untyped.delete(popup._jrUntyped);
    if (!resp) return popup.isConnected ? 0 : -1;
    var texts = [], w = document.createTreeWalker(resp, NodeFilter.SHOW_TEXT, { acceptNode: function (n) {
      return n.parentElement.closest(".katex-mathml") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; // KaTeX's unseen copy
    } });
    while (w.nextNode()) texts.push(w.currentNode);
    var n = popup._jrTyped, i = 0, total = 0;
    texts.forEach(function (t) { total += t.length; });
    while (i < texts.length && n >= texts[i].length) n -= texts[i++].length;
    if (i === texts.length) return 0;
    popup._jrUntyped.setStart(texts[i], n);
    popup._jrUntyped.setEnd(resp, resp.childNodes.length);
    untyped.add(popup._jrUntyped);
    return total - popup._jrTyped;
  }

  function stopTyping(popup) {
    if (popup._jrUntyped) untyped.delete(popup._jrUntyped);
    popup._jrTyped = popup._jrUntyped = null;
  }

  /** R21: styles.css keeps the popup's height limit above the quote + question + 3 answer lines. */
  JR.watchUpper = function (popup) {
    var upper = popup.querySelector(".jr-popup-upper");
    if (!upper) return;
    function set() { popup.style.setProperty("--jr-upper-h", upper.offsetHeight + "px"); }
    set();
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(set).observe(upper);
  };

  /**
   * Put a popup back next to its highlight (spans), on its locked side.
   * Skipped while the highlight is not in the page (its rect would be 0,0).
   */
  JR.placePopup = function (popup, spans) {
    if (!popup || !spans || !spans.length || !spans[0].isConnected) return;
    if (!popup.isConnected) {
      // ChatGPT re-rendered the element that held it: back next to its highlight (a child: into its parent's host)
      var parentPopup = spans[0].closest(".jr-popup");
      var host = parentPopup ? parentPopup.parentElement : JR.site.popupHost(JR.site.turnOf(spans[0]));
      if (!host) return;
      if (getComputedStyle(host).position === "static") host.style.position = "relative";
      host.style.zIndex = "0";
      popup.classList.add("jr-popup--back");
      host.appendChild(popup);
    }
    var rect = JR.getHighlightRect(spans), containerRect = popup.parentElement.getBoundingClientRect();
    placeAt(popup, rect, spans, containerRect);
    JR.posLog("place", popup, { dir: popup._jrLockedDirection, rectTop: rect.top, rectH: rect.height, spans: spans.length, cTop: containerRect.top, popupH: popup.offsetHeight });
  };

  /** Re-place the open (active) popup. */
  JR.repositionPopup = function () {
    JR.placePopup(st.activePopup, st.activeSourceHighlights);
  };

  /**
   * Re-place every open popup, parents first (a child's highlight is inside its parent):
   * after ChatGPT re-lays the chat (window resize, sidebar), not only the active one moved.
   */
  function placeAll() {
    st.popupStack.forEach(function (e) { JR.placePopup(e.popup, e.sourceHighlights); });
    JR.repositionPopup();
  }
  var settleTimer = null;
  JR.repositionAll = function () {
    placeAll();
    // The chat may still be mid re-layout (P19: a highlight measured 643px tall, the popup 30000px away): again once it settles
    clearTimeout(settleTimer);
    settleTimer = setTimeout(placeAll, 300);
  };

  /**
   * Add drag-to-resize handlers to a popup.
   */
  JR.addResizeHandlers = function (popup) {
    var EDGE_ZONE = 6;
    var MIN_WIDTH = 280;
    var MAX_WIDTH = 720;

    var CORNER_ZONE = 12;
    // { x: "left"|"right"|null, y: "top"|"bottom"|null } or null. Both edges resize the height (user, 2026-11-18):
    // dragged outward it grows, and the highlight never moves — the popup grows on its far side (an "above" popup
    // keeps its bottom on the arrow). Every corner but the trash button's (top right) resizes both ways.
    function getEdge(e) {
      if (e.target.closest && e.target.closest(".jr-toolbar-delete")) return null;
      var rect = popup.getBoundingClientRect();
      var y = e.clientY <= rect.top + EDGE_ZONE ? "top" : e.clientY >= rect.bottom - EDGE_ZONE ? "bottom" : null;
      if (y) { // only a popup at its height limit: width only otherwise (read only near those edges)
        var resp = popup.querySelector(":scope > .jr-popup-response");
        if (!resp || resp.scrollHeight <= resp.clientHeight) y = null;
      }
      var zone = y ? CORNER_ZONE : EDGE_ZONE;
      var x = e.clientX <= rect.left + zone ? "left" : e.clientX >= rect.right - zone ? "right" : null;
      if (x === "right" && y === "top") x = null; // the trash corner: height only
      return x || y ? { x: x, y: y } : null;
    }
    function cursorFor(edge) {
      if (!edge.y) return "col-resize";
      if (!edge.x) return "row-resize";
      return (edge.x === "left") === (edge.y === "top") ? "nwse-resize" : "nesw-resize";
    }

    popup.addEventListener("mousemove", function (e) {
      if (popup._jrResizing) return;
      // No resize cursor during delete confirmation
      if (st.confirmingDelete) {
        popup.style.cursor = "";
        return;
      }
      var edge = getEdge(e);
      popup.style.cursor = edge ? cursorFor(edge) : "";
    });

    popup.addEventListener("mouseleave", function () {
      if (!popup._jrResizing) popup.style.cursor = "";
    });

    popup.addEventListener("mousedown", function (e) {
      var edge = getEdge(e);
      if (!edge) return;
      // Block resize during delete confirmation
      if (st.confirmingDelete) return;
      e.preventDefault();

      popup._jrResizing = true;
      // the resize cursor everywhere while dragging (user 2026-11-20: past the popup it was an arrow again)
      var html = document.documentElement;
      html.style.setProperty("--jr-resize-cursor", cursorFor(edge));
      html.classList.add("jr-resizing");
      var startX = e.clientX;
      var startY = e.clientY;
      var startWidth = popup.offsetWidth;
      var startHeight = popup.offsetHeight;
      var startLeft = parseFloat(popup.style.left) || 0;
      var dir = popup._jrLockedDirection;
      // For "above" popups, anchor the bottom edge so the arrow doesn't move
      var anchorBottom = (dir === "above")
        ? (popup._jrBottomAnchor != null ? popup._jrBottomAnchor : (parseFloat(popup.style.top) || 0) + popup.offsetHeight)
        : null;

      // Compute the arrow's X position (relative to container) as the resize limit.
      // Left edge can't go right of arrow; right edge can't go left of arrow.
      var arrowX = null;
      if (st.activeSourceHighlights.length > 0 && popup.parentElement) {
        var hRect = JR.getHighlightRect(st.activeSourceHighlights);
        var cRect = popup.parentElement.getBoundingClientRect();
        arrowX = hRect.left + hRect.width / 2 - cRect.left;
      }

      function onMove(ev) {
        if (edge.y) {
          // Height as a share of the window (40-70vh), so it keeps its share when the window resizes
          var dy = ev.clientY - startY;
          var h = Math.max(40, Math.min(70, (startHeight + (edge.y === "top" ? -dy : dy)) / window.innerHeight * 100));
          popup.style.setProperty("--jr-popup-h", h + "vh");
          if (anchorBottom !== null) popup.style.top = (anchorBottom - popup.offsetHeight) + "px";
        }
        if (!edge.x) return;
        var dx = ev.clientX - startX;
        var newLeft, newRight;
        if (edge.x === "right") {
          newLeft = startLeft;
          newRight = startLeft + startWidth + dx;
        } else {
          newLeft = startLeft + dx;
          newRight = startLeft + startWidth;
        }

        // Clamp so the arrow never moves.
        // Arrow offset in popup = arrowX - newLeft - 9.
        // updateArrow clamps to [12, popupW - 30].
        // So: newLeft ≤ arrowX - 21  AND  newRight ≥ arrowX + 21.
        if (arrowX !== null) {
          if (newLeft > arrowX - 21) newLeft = arrowX - 21;
          if (newRight < arrowX + 21) newRight = arrowX + 21;
        }

        // Clamp edges to sidebar and nav widget boundaries
        var pRect = popup.parentElement ? popup.parentElement.getBoundingClientRect() : { left: 0 };
        var minLeftVp = getPopupMinLeft();
        var maxRightVp = getPopupMaxRight();
        var minLeft = minLeftVp - pRect.left;
        var maxRight = maxRightVp - pRect.left;
        if (newLeft < minLeft) newLeft = minLeft;
        if (newRight > maxRight) newRight = maxRight;

        var newWidth = newRight - newLeft;
        newWidth = Math.max(MIN_WIDTH, Math.min(newWidth, MAX_WIDTH));
        // Re-derive left from the clamped width depending on which edge is being dragged
        if (edge.x === "left") {
          newLeft = newRight - newWidth;
        }

        popup.style.width = newWidth + "px";
        popup.style.left = newLeft + "px";
        // For "above" popups, keep the bottom edge fixed so the arrow stays put
        if (anchorBottom !== null) {
          popup.style.top = (anchorBottom - popup.offsetHeight) + "px";
        }
        if (st.activeSourceHighlights.length > 0 && popup.parentElement) {
          var curDir = popup._jrLockedDirection;
          var adjR = JR.getAdjacentLineRect(st.activeSourceHighlights, curDir);
          var hRect2 = adjR || JR.getHighlightRect(st.activeSourceHighlights);
          var cRect2 = popup.parentElement.getBoundingClientRect();
          JR.updateArrow(popup, hRect2, cRect2, newLeft);
        }
      }

      function onUp() {
        popup._jrResizing = false;
        var h = popup.style.getPropertyValue("--jr-popup-h") || null;
        if (popup._jrChained) {
          st.customPopupWidthChained = popup.offsetWidth;
          st.customPopupHeightChained = h;
        } else {
          st.customPopupWidthL1 = popup.offsetWidth;
          st.customPopupHeightL1 = h;
        }
        // Sync bottom anchor after resize so the ResizeObserver uses the right value
        if (anchorBottom !== null) {
          popup._jrBottomAnchor = anchorBottom;
        }
        popup.style.cursor = "";
        html.classList.remove("jr-resizing");
        html.style.removeProperty("--jr-resize-cursor");
        document.removeEventListener("mousemove", onMove, true);
        document.removeEventListener("mouseup", onUp, true);
      }

      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("mouseup", onUp, true);
    });
  };

  /**
   * Add mouseup handler to a popup that detects text selection inside .jr-popup-response
   * and spawns a chained popup.
   */
  JR.addPopupResponseSelectionHandler = function (popup) {
    popup.addEventListener("mouseup", function (e) {
      e.stopPropagation();
      if (!e.target.closest(".jr-popup-response")) return;
      // Don't interfere with link/entity clicks — let the click handler handle them
      if (e.target.closest("a")) return;
      if (e.target.closest(JR.site.entitySelector)) return;
      if (e.target.closest("button")) return;
      var hlSpan = e.target.closest(".jr-source-highlight");
      if (hlSpan && st.activeSourceHighlights.indexOf(hlSpan) !== -1) {
        var sel = window.getSelection();
        if (sel.isCollapsed) JR.selectSourceHighlightText();
        return;
      }
      if (e.target.closest(".jr-source-highlight-done")) return;
      setTimeout(function () {
        var selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;
        var anchorEl = selection.anchorNode;
        if (anchorEl) {
          var container = anchorEl.nodeType === Node.TEXT_NODE ? anchorEl.parentElement : anchorEl;
          if (container) {
            var srcHL = container.closest(".jr-source-highlight");
            if (srcHL && st.activeSourceHighlights.indexOf(srcHL) !== -1) return;
          }
        }
        var sel = JR.selectionText(selection);
        var range = sel.range;
        var selectedText = sel.text;
        if (!selectedText) return;
        if (!st.activeHighlightId || !st.completedHighlights.has(st.activeHighlightId)) return;
        var hlId = st.activeHighlightId;
        // Show trigger button instead of opening popup immediately
        if (JR.removeTriggerBtn) JR.removeTriggerBtn();
        var selRect = range.getBoundingClientRect();
        JR.showTriggerBtn && JR.showTriggerBtn(
          { text: selectedText, range: range, rect: selRect },
          { parentId: hlId }
        );
      }, 10);
    });

    popup.addEventListener("click", function (e) {
      var hlSpan = e.target.closest(".jr-source-highlight");
      if (hlSpan && st.activeSourceHighlights.indexOf(hlSpan) !== -1) {
        e.stopPropagation();
        JR.selectSourceHighlightText();
      }
    });
  };

  /**
   * Underline the highlights of the open popups (the whole popup stack + hlId).
   */
  JR.syncHighlightActive = function (hlId) {
    // Collect all highlight IDs that should be active:
    // every highlight in the popup stack + the current one
    var activeIds = [];
    for (var si = 0; si < st.popupStack.length; si++) {
      if (st.popupStack[si].highlightId) activeIds.push(st.popupStack[si].highlightId);
    }
    if (hlId) activeIds.push(hlId);

    if (activeIds.length > 0) {
      if (JR.showActiveUnderline) JR.showActiveUnderline(activeIds);
    } else {
      if (JR.removeActiveUnderline) JR.removeActiveUnderline();
    }
  };

  /**
   * Save the current popup state to the stack.
   */
  JR.pushPopupState = function () {
    // only the active popup follows its original: a parent's patches would also redraw its paragraphs, taking away the
    // highlight its child was opened from (review); removePopup has it follow again when it is active again
    if (JR.siteAnswer) JR.siteAnswer.stop();
    st.popupStack.push({
      popup: st.activePopup,
      sourceHighlights: st.activeSourceHighlights,
      highlightId: st.activeHighlightId,
    });
    st.activePopup = null;
    st.activeSourceHighlights = [];
    st.activeHighlightId = null;
  };

  // --- Highlight Navigation (Step 7d) ---

  // Up chevron (caret-up)
  var NAV_UP_SVG = '<svg class="jr-icon-reg" viewBox="0 0 256 256" fill="currentColor"><path d="M213.66,165.66a8,8,0,0,1-11.32,0L128,91.31,53.66,165.66a8,8,0,0,1-11.32-11.32l80-80a8,8,0,0,1,11.32,0l80,80A8,8,0,0,1,213.66,165.66Z"/></svg><svg class="jr-icon-bold" viewBox="0 0 256 256" fill="currentColor"><path d="M216.49,168.49a12,12,0,0,1-17,0L128,97,56.49,168.49a12,12,0,0,1-17-17l80-80a12,12,0,0,1,17,0l80,80A12,12,0,0,1,216.49,168.49Z"/></svg>';
  // Down chevron (caret-down)
  var NAV_DOWN_SVG = '<svg class="jr-icon-reg" viewBox="0 0 256 256" fill="currentColor"><path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80a8,8,0,0,1,11.32-11.32L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z"/></svg><svg class="jr-icon-bold" viewBox="0 0 256 256" fill="currentColor"><path d="M216.49,104.49l-80,80a12,12,0,0,1-17,0l-80-80a12,12,0,0,1,17-17L128,159,199.51,87.51a12,12,0,0,1,17,17Z"/></svg>';

  var navNavigating = false; // suppress updateNavWidget during navigation

  /**
   * Get all level-1 (non-chained) highlight IDs, ordered by DOM position.
   */
  JR.getLevel1HighlightIds = function () {
    // Every level-1 highlight of the conversation, mounted or not: ChatGPT
    // virtualizes the thread, so counting only highlights in the DOM made the
    // total change while scrolling. Order: conversation turn order (from the
    // conversation data), then position inside the turn.
    var order = JR.qa.turnOrderCache;
    if (!order && JR.qa.apiStatus !== "loading") JR.qa.turnOrder().then(function () { JR.updateNavWidget(); });
    var pos = turnPosition(order);

    var items = [];
    var seen = {};
    st.completedHighlights.forEach(function (entry, id) {
      if (entry.parentId || entry._jrTemp || entry.wholeResponse) return;
      seen[id] = true;
      var span = entry.spans && entry.spans[0] && entry.spans[0].isConnected ? entry.spans[0] : null;
      if (!span && !entry.sourceTurnKey) return; // can't place it anywhere
      items.push({ id: id, span: span, turn: entry.sourceTurnKey });
    });
    JR.pendingL1Quotes().forEach(function (q) {
      if (seen[q.quoteId] || !q.sourceTurnKey) return;
      items.push({ id: q.quoteId, span: null, turn: q.sourceTurnKey });
    });

    function rank(it) {
      var at = it.turn ? pos(it.turn) : -1;
      if (at >= 0) return at;
      return it.span ? (order ? order.length : 0) : Infinity; // not in the loaded order: a turn added this session (after all others)
    }
    items.sort(function (a, b) {
      var ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      if (a.span && b.span) {
        var pos = a.span.compareDocumentPosition(b.span);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      }
      return 0;
    });
    return items.map(function (item) { return item.id; });
  };

  /** A turn's place in the conversation: its index in the loaded order (ChatGPT), or the site's own (DeepSeek ids). */
  function turnPosition(order) {
    return JR.site.turnPosition || function (k) { return order ? order.indexOf(k) : -1; };
  }

  /**
   * Scroll the thread until ChatGPT mounts the turn with this key, then call
   * done(true) (done(false) after ~4 s). Direction comes from the turn order:
   * compare the target's index with the turns that are mounted now.
   */
  JR.scrollToTurnKey = function (key, done) {
    var scroller = JR.site.scrollContainer();
    var order = JR.qa.turnOrderCache || [];
    var pos = turnPosition(order);
    var target = pos(key);
    if (scroller && target < 0 && !order.length) { sweepTo(scroller, key, done); return; }
    if (!scroller || target < 0) { done(false); return; }
    if (JR.site.unpin) JR.site.unpin();
    // First jump to the estimated position (when the whole order is known), then step a screen at a time.
    if (order.length) scroller.scrollTop = scroller.scrollHeight * (target / order.length) - scroller.clientHeight / 2;
    var tries = 0;
    (function step() {
      if (JR.site.findTurnByKey(key)) { done(true); return; }
      if (++tries > 40) { done(false); return; }
      var mounted = JR.site.turns().map(function (t) { return pos(JR.site.turnKey(t)); }).filter(function (i) { return i >= 0; });
      var dir = mounted.length && Math.min.apply(null, mounted) > target ? -1 : 1;
      if (JR.site.unpin) JR.site.unpin();
      scroller.scrollTop += dir * scroller.clientHeight * 0.8;
      setTimeout(step, 100);
    })();
  };

  /** No turn order to aim with (Claude Code: no conversation read): up from here to the top, then down from here to
   *  the end, a screen at a time, until its turn is mounted (live round 5: ∧ at the bottom opened nothing). */
  function sweepTo(scroller, key, done) {
    var from = scroller.scrollTop, dir = -1, tries = 0;
    (function step() {
      if (JR.site.findTurnByKey(key)) { done(true); return; }
      if (++tries > 200) { done(false); return; }
      if (dir < 0 && scroller.scrollTop <= 0) { dir = 1; scroller.scrollTop = from; }
      else if (dir > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1) { done(false); return; }
      if (JR.site.unpin) JR.site.unpin();
      scroller.scrollTop += dir * scroller.clientHeight * 0.8;
      setTimeout(step, 100);
    })();
  }

  // --- Navigation order (user, 2026-11-18: "popups in their physical on-page order, popups in popups right after
  // their parent"): highlights by conversation turn, then by place in their answer's text; inside a popup, its
  // highlights by place in its answer (a Reply last), recursively, on the versions shown. A place not on the page
  // comes from the site's data (JR.qa.answerText) once, else creation time.
  var navRecords = null, navPos = new Map(), navAsked = new Set(), navConv = null;
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    // a highlight added or deleted: counted again at once, not at the next press
    // (this conversation's only: every tab hears every write, of every chat)
    chrome.storage.onChanged.addListener(function (changes) { if (!changes[JR_HOST.convKey()]) return; navRecords = null; JR.updateNavWidget(); });
  }
  function records() {
    var conv = JR_HOST.convKey(); // another conversation (the sites move by pushState, not popstate): its own records
    if (conv !== navConv) { navConv = conv; navRecords = null; navPos.clear(); navAsked.clear(); }
    if (navRecords === null && typeof getHighlightsByUrl === "function") {
      var ask = navRecords = {}; // loading; a read started before a change or in another conversation is dropped
      getHighlightsByUrl().then(function (r) {
        if (navRecords === ask) { navRecords = r; JR.updateNavWidget(); }
      }, function () { if (navRecords === ask) navRecords = null; });
    }
    return Array.isArray(navRecords) ? navRecords : null;
  }
  function nthIndex(hay, needle, nth) {
    if (!hay || !needle) return -1;
    var i = -1;
    for (var k = 0; k <= (nth || 0); k++) { i = hay.indexOf(needle, i + 1); if (i < 0) return -1; }
    return i;
  }
  /** Offset of a highlight in its answer's text when it is on the page (in the chat or in an open popup), else -1. */
  function domPos(entry) {
    var span = entry && entry.spans && entry.spans[0];
    if (!span || !span.isConnected) return -1;
    var root = span.closest(".jr-popup-response") ||
      JR.site.assistantBodies(JR.site.turnOf(span)).filter(function (b) { return b.contains(span); })[0];
    if (!root) return -1;
    var r = document.createRange();
    r.setStart(root, 0);
    r.setEndBefore(span);
    return r.toString().length;
  }
  var LATER = 1e12; // place unknown: after the known ones, by creation time

  /** Ids to step through, in that order (null until the stored items are read). */
  function navOrder() { var recs = records(); return recs ? JR.navOrderOf(recs) : null; }
  JR.navOrderOf = function (recs) {
    var byQuote = {}, byId = {};
    recs.forEach(function (r) { (byQuote[r.quoteId] = byQuote[r.quoteId] || []).push(r); byId[r.id] = r; });
    function shown(q) { // the version its popup shows
      var e = st.completedHighlights.get(q), it = e && e.items && e.items[e.activeItemIndex != null ? e.activeItemIndex : e.items.length - 1];
      var rs = byQuote[q];
      return rs.filter(function (r) { return it && r.id === it.id; })[0] || rs.filter(function (r) { return r.active; })[0] || rs[rs.length - 1];
    }
    var shownRecs = Object.keys(byQuote).map(shown), kids = {};
    shownRecs.forEach(function (r) { if (r.parentId) (kids[r.parentItemId] = kids[r.parentItemId] || []).push(r); });
    if (!JR.qa.turnOrderCache && JR.qa.apiStatus !== "loading" && JR.qa.turnOrder) JR.qa.turnOrder().then(function () { JR.updateNavWidget(); });
    var tpos = turnPosition(JR.qa.turnOrderCache);
    function rootPlace(r) { // a turn's highlights are all on the page or all not: offsets of one kind per turn
      var d = domPos(st.completedHighlights.get(r.quoteId));
      if (d >= 0) return d;
      if (navPos.has(r.quoteId)) return navPos.get(r.quoteId); // in the site's data (Markdown)
      if (r.sourceTurnKey && JR.qa.answerText && !navAsked.has(r.quoteId)) {
        navAsked.add(r.quoteId);
        JR.qa.answerText(r.sourceTurnKey).then(function (t) {
          var i = nthIndex(t, r.text, r.nth);
          if (i >= 0 && !navPos.has(r.quoteId)) { navPos.set(r.quoteId, i); JR.updateNavWidget(); }
        });
      }
      return LATER + (r.createdAt || 0);
    }
    function childPlace(parent, c) {
      if (c.wholeResponse) return 2 * LATER + (c.createdAt || 0); // a Reply: after the answer's highlights
      var d = domPos(st.completedHighlights.get(c.quoteId));
      if (d >= 0) return d;
      var t = JR.qa.text(parent.turnKeys || []);
      var i = t ? nthIndex(t, c.text, c.nth) : -1;
      return i >= 0 ? i : LATER + (c.createdAt || 0);
    }
    var out = [];
    function emit(list, placeOf) {
      list.map(function (r) { return { r: r, k: placeOf(r) }; })
        .sort(function (a, b) { return a.k[0] - b.k[0] || a.k[1] - b.k[1] || (a.r.createdAt || 0) - (b.r.createdAt || 0); })
        .forEach(function (x) {
          out.push(x.r.quoteId);
          emit(kids[x.r.id] || [], function (c) { return [0, childPlace(x.r, c)]; });
        });
    }
    emit(shownRecs.filter(function (r) { return !r.parentId && !r.wholeResponse; }), function (r) {
      var t = r.sourceTurnKey ? tpos(r.sourceTurnKey) : -1;
      return [t >= 0 ? t : Infinity, rootPlace(r)];
    });
    out.chain = function (q) { // the versions to open, from the chat down to q (as the outline does)
      var r = byQuote[q] && shown(q), chain = r ? [r] : [];
      while (chain.length && chain[0].parentId) {
        var up = byId[chain[0].parentItemId] || (byQuote[chain[0].parentId] && shown(chain[0].parentId));
        if (!up) break;
        chain.unshift(up);
      }
      return chain;
    };
    out.turnOf = function (q) { var c = out.chain(q); return c.length ? c[0].sourceTurnKey : null; }; // its root's turn
    return out;
  };

  /** With no popup open: the index ∨ (direction 1) or ∧ (−1) goes to, from the highlights on the page now; -1: none. */
  function nearestFromView(ids, direction) {
    var band = JR.site.visibleBand(), firstBelow = -1, lastAbove = -1;
    // the turns in view, by their place in the conversation
    var pos = turnPosition(JR.qa.turnOrderCache), lo = Infinity, hi = -1;
    Array.prototype.forEach.call(document.querySelectorAll(JR.SEL.turn), function (t) {
      var r = t.getBoundingClientRect(), p = pos(JR.site.turnKey(t));
      if (p >= 0 && r.height > 0 && r.bottom > band.top && r.top < band.bottom) { lo = Math.min(lo, p); hi = Math.max(hi, p); }
    });
    ids.forEach(function (id, i) {
      var e = st.completedHighlights.get(id), sp = e && e.spans && e.spans[0];
      if (sp && sp.isConnected && !sp.closest(".jr-popup")) {
        var r = sp.getBoundingClientRect();
        if (direction > 0 && firstBelow < 0 && r.top >= band.top) firstBelow = i;
        if (direction < 0 && r.bottom <= band.bottom) lastAbove = i;
        return;
      }
      // not wrapped (yet): by its turn — one in a turn in view or after it counts as on the way down (live round 4,
      // claude.ai B17: at the top ∨ went to 5 of 10 — the first four, in turns on screen, weren't wrapped again yet)
      var p = hi >= 0 && ids.turnOf ? pos(ids.turnOf(id)) : -1;
      if (p < 0) return;
      if (direction > 0 && firstBelow < 0 && p >= lo) firstBelow = i;
      if (direction < 0 && p <= hi) lastAbove = i;
    });
    if (direction > 0 ? firstBelow >= 0 : lastAbove >= 0) return direction > 0 ? firstBelow : lastAbove;
    // None that way (their turns not mounted — a long chat, the review of dev.104): by turn, from the turns in view —
    // the first highlight in a turn after them, or the last in one before them
    var pick = -1, unknown = hi < 0 || !ids.turnOf;
    if (!unknown) ids.forEach(function (id, i) {
      var p = pos(ids.turnOf(id));
      if (p < 0) { unknown = true; return; }
      if (direction > 0 && pick < 0 && p > hi) pick = i;
      if (direction < 0 && p < lo) pick = i;
    });
    if (pick >= 0 || !unknown) return pick; // -1: none that way
    // no turn order to tell (Claude Code: rows not mounted, no conversation read): by where the reader is in the chat —
    // at the bottom ∧ is the last one, at the top ∨ the first (live round 5: ∧ at the bottom opened nothing near)
    var sc = JR.site.scrollContainer(), room = sc ? sc.scrollHeight - sc.clientHeight : 0;
    var at = (room > 0 ? sc.scrollTop / room : direction > 0 ? 0 : 1) * (ids.length - 1);
    return direction > 0 ? Math.min(ids.length - 1, Math.ceil(at)) : Math.max(0, Math.floor(at));
  }

  /**
   * Find the index of the open popup (or its nearest listed parent) for the current activeHighlightId.
   */
  function findCurrentL1Index(ids) {
    // no popup open: none is current, even if an id was left behind (live dev.105: ∨ at the top went 36 → 37, the last)
    if (!st.activeHighlightId || !st.activePopup) return -1;
    // the popup itself, else its nearest listed parent (a new one, not saved yet, inside a level-3 popup: level 3)
    for (var id = st.activeHighlightId, n = 0; id && n < 100; n++) {
      var idx = ids.indexOf(id);
      if (idx !== -1) return idx;
      var entry = st.completedHighlights.get(id);
      id = entry && entry.parentId;
    }
    return -1;
  }

  function buildNavWidget() {
    var widget = document.createElement("div");
    widget.className = "jr-nav-widget jr-nav-widget--" + JR.site.name;

    var upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "jr-nav-up";
    upBtn.setAttribute("aria-label", "Previous highlight");
    upBtn.innerHTML = NAV_UP_SVG;

    var indicator = document.createElement("span");
    indicator.className = "jr-nav-indicator";

    var downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "jr-nav-down";
    downBtn.setAttribute("aria-label", "Next highlight");
    downBtn.innerHTML = NAV_DOWN_SVG;

    widget.appendChild(upBtn);
    widget.appendChild(indicator);
    widget.appendChild(downBtn);

    upBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      JR.navigateHighlight(-1);
    });

    downBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      JR.navigateHighlight(1);
    });

    widget.addEventListener("mousedown", function (e) {
      e.stopPropagation();
    });

    return widget;
  }

  /**
   * Create, update, or hide the floating highlight navigation widget.
   * Only tracks level-1 (non-chained) highlights.
   */
  JR.updateNavWidget = function () { // [LAYOUT-LOCKED] sidebar hide/show logic
    if (navNavigating) return;

    var ids = navOrder() || JR.getLevel1HighlightIds();
    var sidebarOpen = JR.isRightSidebarOpen();

    if (ids.length < 1 || sidebarOpen) {
      if (st.navWidget) {
        if (sidebarOpen && ids.length >= 1) {
          // Sidebar open but highlights exist — just hide, don't destroy
          st.navWidget.style.display = "none";
          return;
        }
        if (st.navWidget._jrScrollCleanup) st.navWidget._jrScrollCleanup();
        st.navWidget.remove();
        st.navWidget = null;
      }
      return;
    }

    // Sidebar closed — ensure widget is visible
    if (st.navWidget) st.navWidget.style.display = "";
    var navRight = JR.site.navRight ? JR.site.navRight() : null; // (Claude Code: inside the chat's right edge)

    if (!st.navWidget) {
      st.navWidget = buildNavWidget();
      document.body.appendChild(st.navWidget);
      // Listen for scroll to update disabled state dynamically
      var scrollParent = JR.site.scrollContainer() || window;
      // At most once per frame: this used to run layout reads on every scroll
      // event, including ChatGPT's own scrolling while it streams.
      var navRaf = 0;
      var scrollHandler = function () {
        if (navRaf) return;
        navRaf = requestAnimationFrame(function () {
          navRaf = 0;
          if (!st.navWidget) return;
          if (JR.perf) JR.perf.count("navScroll");
          JR.updateNavDisabled();
        });
      };
      (scrollParent === window ? window : scrollParent)
        .addEventListener("scroll", scrollHandler, { passive: true });
      st.navWidget._jrScrollCleanup = function () {
        (scrollParent === window ? window : scrollParent)
          .removeEventListener("scroll", scrollHandler);
      };
    }

    st.navWidget._jrIds = ids;
    var right = navRight == null ? "" : navRight + "px";
    if (st.navWidget.style.right !== right) st.navWidget.style.right = right;

    var currentIdx = findCurrentL1Index(ids);

    var indicator = st.navWidget.querySelector(".jr-nav-indicator");
    if (currentIdx >= 0) {
      indicator.textContent = (currentIdx + 1) + " / " + ids.length;
    } else {
      indicator.textContent = "" + ids.length;
    }

    JR.updateNavDisabled();
  };

  /**
   * Update just the disabled state of nav arrows (called on scroll + updateNavWidget).
   */
  JR.updateNavDisabled = function () {
    if (!st.navWidget || !st.navWidget._jrIds) return;
    var ids = st.navWidget._jrIds;
    var upBtn = st.navWidget.querySelector(".jr-nav-up");
    var downBtn = st.navWidget.querySelector(".jr-nav-down");
    if (st.confirmingDelete) {
      upBtn.disabled = true;
      downBtn.disabled = true;
      return;
    }
    var currentIdx = findCurrentL1Index(ids);
    if (currentIdx === -1) {
      upBtn.disabled = nearestFromView(ids, -1) < 0;
      downBtn.disabled = nearestFromView(ids, 1) < 0;
    } else {
      upBtn.disabled = (currentIdx === 0);
      downBtn.disabled = (currentIdx === ids.length - 1);
    }
  };

  /**
   * Navigate to the previous or next level-1 highlight.
   * @param {number} direction  -1 for previous (up), +1 for next (down)
   */
  JR.navigateHighlight = function (direction) {
    if (st.confirmingDelete) return;
    if (!st.navWidget || !st.navWidget._jrIds) return;
    var ids = st.navWidget._jrIds;
    if (ids.length === 0) return;

    var currentIdx = findCurrentL1Index(ids);

    var nextIdx;
    if (currentIdx === -1) {
      // The next one from where the user is (user, 2026-11-18: at the top ∨ jumped to the 42nd; with none in view it
      // did nothing — only the first highlight was looked at, and the ones after the view weren't mounted)
      nextIdx = nearestFromView(ids, direction);
    } else {
      nextIdx = currentIdx + direction;
    }
    if (nextIdx < 0 || nextIdx >= ids.length) return;

    var targetId = ids[nextIdx]; // may not be in memory yet (turn not mounted); scrollToAndOpenPopup handles it
    var chain = ids.chain ? ids.chain(targetId) : [];

    // Suppress intermediate updateNavWidget calls during navigation
    navNavigating = true;
    if (chain.length > 1) openChain(chain, function () {}); // a popup inside a popup: open its parents first
    else JR.scrollToAndOpenPopup(targetId);
    navNavigating = false;
    JR.updateNavWidget();
  };

  /**
   * Open the popup a sent Popup message belongs to (DeepSeek's question outline lists them) — that very question:
   * from its highlight in the chat down through nested popups / Reply, each on the version that leads there, the
   * last on the version that asked it. Found in the stored items by highlighted text, then by the question.
   * Progress in html[data-jr-outline] (for tests).
   */
  JR.openPopupForMessage = function (msg) {
    var p = JR.parsePopupMessage(msg);
    function trace(t) { document.documentElement.setAttribute("data-jr-outline", t); }
    if (!p) return trace("not a popup message");
    trace("looking");
    getHighlightsByUrl().then(function (records) {
      var chain = JR.chainForMessage(records, p);
      if (!chain) return trace("no stored item for it");
      openChain(chain, trace);
    });
  };

  /** The stored items (versions) to open, from the chat's highlight down to the one that asked p; null if none. */
  // This conversation's stored items, to tell a deleted popup (its messages stay at the site) from a kept one (a site's
  // own list of the messages: DeepSeek's outline — architecture #6, moved out of sites/deepseek.js); read again when
  // storage changes (the outline is marked every 500 ms, so a late read corrects itself)
  var msgRecords = null, msgRecordsUrl = null, msgKept = new WeakMap(); // records → messages that have a stored item
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function (changes) { if (changes[JR_HOST.convKey()]) msgRecords = null; });
  }
  function storedItems() {
    if (msgRecordsUrl !== location.pathname) { msgRecords = null; msgRecordsUrl = location.pathname; }
    if (msgRecords === null && typeof getHighlightsByUrl === "function") {
      msgRecords = false; // loading
      getHighlightsByUrl().then(function (r) { msgRecords = r; }, function () { msgRecords = null; });
    }
    return msgRecords || null;
  }
  /** A Popup message (parsed p) deleted in Popup: no stored item for it — only once the questions of the stored items
   *  it could be are read back (before that a Reply can't be told apart: not "deleted" yet). False while loading. */
  JR.popupMessageDeleted = function (msg, p) {
    var recs = storedItems();
    if (!recs) return false;
    var set = msgKept.get(recs);
    if (!set) msgKept.set(recs, set = new Set());
    if (set.has(msg)) return false;
    if (JR.chainForMessage(recs, p)) { set.add(msg); return false; }
    var norm = function (t) { return String(t || "").replace(/\s+/g, " ").trim(); };
    return recs.filter(function (r) { return p.text == null ? r.wholeResponse : norm(r.text) === norm(p.text); })
      .every(function (r) { return JR.qa.question(r.turnKeys || []) != null; }); // every one it could be is known and isn't it
  };

  JR.chainForMessage = function (records, p) {
    function norm(t) { return String(t || "").replace(/\s+/g, " ").trim(); }
    // a Reply's message carries no quote (its record's text is the answer's start): any Reply, told apart by question
    var same = records.filter(function (r) { return p.text == null ? r.wholeResponse : norm(r.text) === norm(p.text); });
    var asked = same.filter(function (r) { var q = JR.qa.question(r.turnKeys || []); return q != null && norm(q) === norm(p.question); });
    var quotes = new Set(same.map(function (r) { return r.quoteId; }));
    var hit = asked[0] || (quotes.size === 1 ? same.filter(function (r) { return r.active; })[0] || same[0] : null);
    if (!hit) return null;
    var byId = {};
    records.forEach(function (r) { byId[r.id] = r; });
    var chain = [hit];
    while (chain[0].parentId) {
      var up = byId[chain[0].parentItemId] || records.filter(function (r) { return r.quoteId === chain[0].parentId && r.active; })[0];
      if (!up) break;
      chain.unshift(up);
    }
    return chain;
  };

  /** Make rec's version the one its popup shows (as the ‹ › arrows do). True if it changed. */
  function showVersion(rec) {
    var e = st.completedHighlights.get(rec.quoteId);
    var i = e && e.items ? e.items.map(function (it) { return it.id; }).indexOf(rec.id) : -1;
    if (i < 0 || e.activeItemIndex === i) return false;
    e.activeItemIndex = i;
    e.question = e.items[i].question;
    setActiveItem(rec.quoteId, rec.id);
    return true;
  }

  function openChain(chain, trace) {
    var k = 0, waited = 0;
    function wait(what, again) {
      if (gen !== navGen) return trace("dropped: another jump"); // as in scrollToAndOpenPopup
      if ((waited += 100) > 6000) return trace("stuck: " + what);
      setTimeout(again, 100);
    }
    showVersion(chain[0]);
    JR.scrollToAndOpenPopup(chain[0].quoteId);
    var gen = navGen;
    (function level() {
      if (gen !== navGen) return trace("dropped: another jump");
      var rec = chain[k];
      if (!st.activePopup || st.activeHighlightId !== rec.quoteId) return wait("level " + (k + 1) + " popup", level);
      if (showVersion(rec)) JR.rebuildPopupAfterEdit(st.activePopup, rec.quoteId); // was not in memory before it opened
      if (++k >= chain.length) return trace("opened " + chain.length + " level(s)");
      var child = chain[k];
      waited = 0;
      (function openChild() {
        var target = st.activePopup && (child.wholeResponse ? st.activePopup.querySelector(".jr-reply-whole-btn")
          : st.activePopup.querySelector('[data-jr-highlight-id="' + child.quoteId + '"]'));
        if (!target || !st.completedHighlights.has(child.quoteId)) return wait("level " + (k + 1) + " highlight", openChild);
        // a Reply once this one's answer is in, as a highlight (which is in it) is: its button is there before — opened
        // on, this one stayed on "Loading…" as a parent (only the active popup follows; live P0-2, dev.151) — 5 s at most
        var waiting = child.wholeResponse && st.activePopup.querySelector(":scope > .jr-popup-response--waiting");
        if (waiting && waited < 5000) return wait("level " + (k + 1) + " answer", openChild);
        showVersion(child);
        waited = 0;
        openAt(target, function () { target.click(); }); // as the user would: Reply, or the highlight inside the popup
        level();
      })();
    })();
  }

  /**
   * A jump the user asked for (^ v, the outline) brings the highlight to the bottom fifth of the chat's visible part
   * (user, 2026-11-18): the popup opens above it with room to grow, and from then on the highlight stays put —
   * nothing scrolls while the answer loads (the popup grows upward).
   */
  function bringLow(span) {
    var sc = JR.site.scrollContainer();
    if (!sc || !span || !span.isConnected) return;
    var band = JR.site.visibleBand(), h = band.bottom - band.top;
    if (JR.site.unpin) JR.site.unpin();
    sc.scrollTop += span.getBoundingClientRect().top - (band.top + 0.82 * h);
    // Where it can't get that low (the start of the chat): the top, so the popup opens below and grows down — not
    // below a high highlight, behind the composer (Codex, DeepSeek's first highlights)
    var top = span.getBoundingClientRect().top;
    if (top < band.top + 0.82 * h - 2) sc.scrollTop += top - (band.top + 0.15 * h);
  }
  /** Every popup a jump opens, at any level (user, 2026-11-18: "the same for the 1st or the 100th"): its highlight goes
   *  low first, then it opens — choosing its side where the highlight now is: above. Its height is as on a click. */
  function openAt(span, open) {
    var resp = span.closest(".jr-popup-response"); // inside a parent popup: in view in its answer first
    if (resp) {
      var rr = resp.getBoundingClientRect(), sr = span.getBoundingClientRect();
      if (sr.top < rr.top || sr.bottom > rr.bottom) resp.scrollTop += sr.top - rr.top - (rr.height - sr.height) / 2;
    }
    bringLow(span);
    open();
  }

  /**
   * Convenience: close all popups, scroll to a highlight, and open its popup.
   */
  var navGen = 0; // a jump still scrolling to its highlight is dropped once another jump starts or popups are closed
  JR.scrollToAndOpenPopup = function (hlId) {
    JR.removeAllPopups();
    var gen = navGen;
    var entry = st.completedHighlights.get(hlId);
    var connected = entry && entry.spans && entry.spans.length > 0 && entry.spans[0].isConnected;
    var sc0 = JR.site.scrollContainer();
    JR.navTrace = hlId.slice(0, 8) + (connected ? " on page y=" + Math.round(entry.spans[0].getBoundingClientRect().top) : " not on page");
    if (connected) {
      openAt(entry.spans[0], function () {
        JR.navTrace += " → y=" + Math.round(entry.spans[0].getBoundingClientRect().top) + " scrollTop=" + Math.round(sc0 ? sc0.scrollTop : -1);
        JR.createPopup({ completedId: hlId });
      });
      return;
    }
    // Highlight's turn isn't in the DOM (virtualized): scroll until ChatGPT
    // mounts it, wait for the highlight to be re-applied, then open it.
    var q = entry || JR.pendingL1Quotes().filter(function (p) { return p.quoteId === hlId; })[0];
    if (!q || !q.sourceTurnKey) { JR.navTrace += ", no turn key"; return; }
    JR.navTrace += ", turn " + q.sourceTurnKey.slice(0, 8) + " at " + turnPosition(JR.qa.turnOrderCache)(q.sourceTurnKey) + "/" + (JR.qa.turnOrderCache || []).length;
    JR.scrollToTurnKey(q.sourceTurnKey, function (ok) {
      JR.navTrace += ", reached=" + ok + (gen !== navGen ? " (dropped)" : "");
      if (!ok || gen !== navGen) return;
      var waited = 0;
      (function open() {
        if (gen !== navGen) return; // the user went elsewhere meanwhile (user, 2026-11-18: two popups at once)
        var e = st.completedHighlights.get(hlId);
        if (e && e.spans && e.spans[0] && e.spans[0].isConnected) {
          openAt(e.spans[0], function () {
            JR.navTrace += ", opened at y=" + Math.round(e.spans[0].getBoundingClientRect().top);
            JR.createPopup({ completedId: hlId });
          });
          JR.updateNavWidget();
          return;
        }
        if ((waited += 100) > 2000) return;
        if (JR.reapplyHighlights) JR.reapplyHighlights();
        setTimeout(open, 100);
      })();
    });
  };

  /**
   * Close all open popups (active + entire stack).
   */
  JR.removeAllPopups = function () {
    navGen++;
    st.confirmingDelete = false;
    if (JR.removeTriggerBtn) JR.removeTriggerBtn();
    while (st.activePopup || st.popupStack.length > 0) {
      JR.removePopup();
    }
    // A popup Popup lost track of (two jumps racing, user 2026-11-18) can't stay behind: it would never fill in nor close
    Array.prototype.forEach.call(document.querySelectorAll(".jr-popup"), function (p) {
      if (!p._jrMade) return;
      if (p._jrAboveObserver) p._jrAboveObserver.disconnect();
      if (p._jrScrollCleanup) p._jrScrollCleanup();
      p.remove();
    });
  };

  function detachPopupState() {
    if (JR.removeTriggerBtn) JR.removeTriggerBtn();
    if (st.cancelResponseWatch) st.cancelResponseWatch(); // detach: the answer keeps saving in the background
    st.activeSourceHighlights = [];
  }

  JR.removePopup = function () {
    JR.posLog("remove", st.activePopup, { stack: st.popupStack.length, sending: !!st.cancelResponseWatch });
    var isCompleted = false;
    var isTemp = false;
    var isReplyAnchor = st.activeSourceHighlights.length > 0 && !!st.activeSourceHighlights[0]._jrReplyAnchor;
    if (!isReplyAnchor && st.activeSourceHighlights.length > 0) {
      var hlId = st.activeSourceHighlights[0].getAttribute("data-jr-highlight-id");
      if (hlId && st.completedHighlights.has(hlId)) {
        var hlEntry = st.completedHighlights.get(hlId);
        if (hlEntry && hlEntry._jrTemp) {
          isTemp = true;
          st.completedHighlights.delete(hlId);
        } else {
          isCompleted = true;
        }
      }
    }

    if (isReplyAnchor) {
      detachPopupState();
      // Clean up temp entry if the question was never sent
      if (st.activeHighlightId) {
        var tempEntry = st.completedHighlights.get(st.activeHighlightId);
        if (tempEntry && tempEntry._jrTemp) {
          st.completedHighlights.delete(st.activeHighlightId);
        }
      }
    } else if (isCompleted || st.cancelResponseWatch) {
      detachPopupState();
    } else {
      JR.removeSourceHighlight();
    }

    if (st.activePopup) {
      if (st.activePopup._jrAboveObserver) {
        st.activePopup._jrAboveObserver.disconnect();
        st.activePopup._jrAboveObserver = null;
      }
      if (st.activePopup._jrScrollCleanup) {
        st.activePopup._jrScrollCleanup();
        st.activePopup._jrScrollCleanup = null;
      }
      var popupParent = st.activePopup.parentElement;
      st.activePopup.remove();
      st.activePopup = null;
      if (popupParent && st.popupStack.length === 0) {
        popupParent.style.zIndex = "";
      }
    }
    st.activeHighlightId = null;

    if (st.popupStack.length > 0) {
      var prev = st.popupStack.pop();
      st.activePopup = prev.popup;
      st.activeSourceHighlights = prev.sourceHighlights;
      st.activeHighlightId = prev.highlightId;
    }
    // Only the active popup follows its original (design A): this one let go; the parent, active again, follows its
    // own — a moment later, unless it is closed too (closing all of them)
    if (JR.siteAnswer) JR.siteAnswer.stop();
    var back = st.activePopup, backResp = back && back.querySelector(":scope > .jr-popup-response");
    if (backResp && backResp._jrSiteFollow) setTimeout(function () { if (st.activePopup === back && backResp.isConnected) backResp._jrSiteFollow(); }, 0);
    JR.syncHighlightActive(st.activeHighlightId);
    JR.updateNavWidget();
  };
})();

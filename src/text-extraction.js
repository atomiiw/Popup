// text-extraction.js — Text extraction & sentence detection
(function () {
  "use strict";

  var BLOCK_TAGS = JR.BLOCK_TAGS;
  var SENTENCE_TERMINATORS = JR.SENTENCE_TERMINATORS;

  /**
   * Is text[i] a sentence end? Not inside a formula's TeX (\( … \), \[ … \]):
   * "0.5" or "x." in a formula must not cut the sentence (or the formula) apart.
   * hasMath: the block really holds formulas (plain text may contain "\(" too).
   */
  function endsSentence(text, i, hasMath) {
    if (SENTENCE_TERMINATORS.indexOf(text[i]) === -1) return false;
    if (!hasMath) return true;
    var re = /\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g, m;
    while ((m = re.exec(text)) && m.index <= i) {
      if (i < m.index + m[0].length) return false;
    }
    return true;
  }

  /**
   * Walk a block element's DOM tree and extract its text content,
   * recording the positions of citation pill elements (data-testid="webpage-citation-pill").
   * Returns { text: string, pills: [{start, end}], bolds: [{start, end}] }.
   */
  JR.extractBlockText = function (node) {
    var raw = "";
    var pills = [];
    var bolds = [];

    function walk(n, inBold) {
      if (n.nodeType === Node.TEXT_NODE) {
        if (inBold) {
          var bStart = raw.length;
          raw += n.textContent;
          bolds.push({ start: bStart, end: raw.length });
        } else {
          raw += n.textContent;
        }
        return;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      if (n.matches(JR.site.hiddenTextSelector)) return;
      if (n.matches(JR.site.mathSelector)) { raw += JR.mathText(n); return; }
      // Citation pill — capture as a unit, record position
      if (n.matches && n.matches(JR.site.citationSelector)) {
        var start = raw.length;
        raw += n.textContent;
        pills.push({ start: start, end: raw.length });
        return;
      }
      var nowBold = inBold || n.matches(JR.site.strongSelector);
      for (var child = n.firstChild; child; child = child.nextSibling) {
        walk(child, nowBold);
      }
    }

    walk(node, false);

    // Merge adjacent bold ranges
    if (bolds.length > 1) {
      var merged = [bolds[0]];
      for (var mi = 1; mi < bolds.length; mi++) {
        var prev = merged[merged.length - 1];
        if (bolds[mi].start <= prev.end) {
          prev.end = Math.max(prev.end, bolds[mi].end);
        } else {
          merged.push(bolds[mi]);
        }
      }
      bolds = merged;
    }

    // Adjust positions for leading whitespace that trim() removes
    var leadingWS = raw.length - raw.trimStart().length;
    var trimmed = raw.trim();
    if (leadingWS > 0) {
      var ranges = [pills, bolds];
      for (var r = 0; r < ranges.length; r++) {
        var arr = ranges[r];
        for (var i = arr.length - 1; i >= 0; i--) {
          arr[i].start -= leadingWS;
          arr[i].end -= leadingWS;
          if (arr[i].end <= 0 || arr[i].start >= trimmed.length) {
            arr.splice(i, 1);
          } else {
            arr[i].start = Math.max(0, arr[i].start);
            arr[i].end = Math.min(trimmed.length, arr[i].end);
          }
        }
      }
    }

    return { text: trimmed, pills: pills, bolds: bolds };
  };

  function hasBlockAncestor(node, container) {
    for (var el = node.parentElement; el && el !== container; el = el.parentElement) {
      if (BLOCK_TAGS.has(el.tagName)) return true;
    }
    return false;
  }

  /**
   * Extract the containing sentence(s) for a selection range within a container element.
   * For single-block selections, expands to sentence boundaries.
   * For multi-block selections, collects the full text of each selected block.
   * Works for both AI response articles and popup response divs.
   * Returns the trimmed string, or null on failure.
   */
  JR.extractSentenceInContainer = function (range, blockTypes, container) {
    var selectedBlocks = [];
    var leafWalker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (node) {
        if (node.matches(JR.site.hiddenTextSelector)) return NodeFilter.FILTER_REJECT;
        if (isCodeBlock(node)) return NodeFilter.FILTER_ACCEPT; // a code block is one unit
        if (node.closest && node.closest(JR.site.codeBlockSelector)) return NodeFilter.FILTER_SKIP;
        // A display formula placed straight in the answer (no paragraph around it) is one unit too.
        if (node.matches(JR.site.mathDisplaySelector) && !hasBlockAncestor(node, container)) return NodeFilter.FILTER_ACCEPT;
        if (!BLOCK_TAGS.has(node.tagName)) return NodeFilter.FILTER_SKIP;
        // Only the innermost blocks: current answers nest li > div > div > p
        return node.querySelector(innerBlockSelector()) ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_ACCEPT;
      }
    });
    var leafNode;
    while ((leafNode = leafWalker.nextNode())) {
      if (range.intersectsNode(leafNode)) selectedBlocks.push(leafNode);
    }
    // A selection in a chart's plot (ticks, legend, tooltip): its words alone mean little,
    // so the quote says which chart, from its title.
    var chartEl = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
    var chart = chartEl && chartEl.closest(JR.site.chartPlotSelector) && JR.site.chartContext(chartEl);
    if (chart) {
      var picked = [], tw = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT, null), tn;
      if (range.commonAncestorContainer.nodeType === Node.TEXT_NODE) picked.push(range.toString());
      while ((tn = tw.nextNode())) {
        if (!range.intersectsNode(tn)) continue;
        picked.push(tn.data.slice(tn === range.startContainer ? range.startOffset : 0, tn === range.endContainer ? range.endOffset : tn.data.length));
      }
      picked = picked.join(" ").replace(/\s+/g, " ").trim(); // chart labels are separate <text>s
      if (blockTypes) blockTypes.push({ tag: "P", depth: 0, lineCount: 2, pills: [], bolds: null });
      return "Chart: " + chart + "\n" + picked;
    }
    if (selectedBlocks.length === 0) return null;

    var startBlock = selectedBlocks[0];
    var endBlock = selectedBlocks[selectedBlocks.length - 1];

    function shiftRanges(arr, shift, textLen) {
      var result = [];
      for (var i = 0; i < arr.length; i++) {
        var s = arr[i].start - shift;
        var e = arr[i].end - shift;
        if (e > 0 && s < textLen) {
          result.push({ start: Math.max(0, s), end: Math.min(textLen, e) });
        }
      }
      return result;
    }

    function trimLeadingPills(text, pills, bolds) {
      while (pills.length > 0 && pills[0].start === 0) {
        var pEnd = pills[0].end;
        pills.shift();
        var rest = text.slice(pEnd);
        var ws = rest.length - rest.trimStart().length;
        text = rest.trimStart();
        var shift = pEnd + ws;
        pills = shiftRanges(pills, shift, text.length);
        bolds = shiftRanges(bolds, shift, text.length);
      }
      return { text: text, pills: pills, bolds: bolds };
    }

    // Multi-block selection
    if (selectedBlocks.length > 1) {
      var blocks = [];
      var prevLI = null;
      for (var bi = 0; bi < selectedBlocks.length; bi++) {
        var node = selectedBlocks[bi];
        var extracted = isCodeBlock(node) ? { text: codeLines(node, range), pills: [], bolds: [] } : JR.extractBlockText(node);
        var nodeHasMath = !!node.querySelector(JR.site.mathSelector);
        var blockText = extracted.text;
        var blockPills = extracted.pills;
        var blockBolds = extracted.bolds;
        var isFirstSent = true;

        if (node === startBlock && !isCodeBlock(node) && node.contains(range.startContainer)) {
          var rawOffS = JR.getOffsetInBlock(node, range.startContainer, range.startOffset);
          var nodeTextS = JR.plainText(node);
          var leadWSS = nodeTextS.length - nodeTextS.trimStart().length;
          var trimOffS = Math.max(0, rawOffS - leadWSS);
          var bSS = 0;
          for (var si = trimOffS - 1; si >= 0; si--) {
            if (endsSentence(blockText, si, nodeHasMath)) { bSS = si + 1; break; }
          }
          if (bSS > 0) {
            isFirstSent = false;
            var slicedS = blockText.slice(bSS);
            var sliceLeadS = slicedS.length - slicedS.trimStart().length;
            blockText = slicedS.trim();
            blockPills = shiftRanges(blockPills, bSS + sliceLeadS, blockText.length);
            blockBolds = shiftRanges(blockBolds, bSS + sliceLeadS, blockText.length);
          }
        }

        if (node === endBlock && !isCodeBlock(node) && node.contains(range.endContainer)) {
          var rawOffE = JR.getOffsetInBlock(node, range.endContainer, range.endOffset);
          var nodeTextE = JR.plainText(node);
          var leadWSE = nodeTextE.length - nodeTextE.trimStart().length;
          var trimOffE = Math.min(blockText.length, Math.max(0, rawOffE - leadWSE));
          var bSE = blockText.length;
          for (var si2 = trimOffE; si2 < blockText.length; si2++) {
            if (endsSentence(blockText, si2, nodeHasMath)) { bSE = si2 + 1; break; }
          }
          if (bSE < blockText.length) {
            blockText = blockText.slice(0, bSE).trim();
            blockPills = shiftRanges(blockPills, 0, blockText.length);
            blockBolds = shiftRanges(blockBolds, 0, blockText.length);
          }
        }

        if (blocks.length === 0 && blockPills.length > 0 && blockPills[0].start === 0) {
          var trimmed = trimLeadingPills(blockText, blockPills, blockBolds);
          blockText = trimmed.text;
          blockPills = trimmed.pills;
          blockBolds = trimmed.bolds;
        }

        if (!blockText) { continue; }

        blocks.push(blockText);
        if (blockTypes) {
          var closestLI = node.closest("li");
          var depth = 0;
          var listType = "ul";
          var listStart = 1;
          if (closestLI) {
            var ancestor = node.parentElement;
            while (ancestor && ancestor !== container) {
              if (ancestor.tagName === "UL" || ancestor.tagName === "OL") {
                if (depth === 0) {
                  listType = ancestor.tagName === "OL" ? "ol" : "ul";
                  if (ancestor.tagName === "OL") {
                    var liOrd = 1;
                    var prevSib = closestLI.previousElementSibling;
                    while (prevSib) {
                      if (prevSib.tagName === "LI") liOrd++;
                      prevSib = prevSib.previousElementSibling;
                    }
                    listStart = liOrd;
                  }
                }
                depth++;
              }
              ancestor = ancestor.parentElement;
            }
          }
          var tag;
          var isFirstBlk = !closestLI || node === closestLI || closestLI.querySelector(innerBlockSelector()) === node;
          if (isCodeBlock(node)) {
            tag = "PRE";
          } else if (!closestLI) {
            tag = node.tagName;
          } else if (closestLI === prevLI) {
            tag = "LI_CONT";
          } else if (!isFirstSent || !isFirstBlk) {
            tag = "LI_CONT";
          } else {
            tag = "LI";
          }
          prevLI = closestLI;
          blockTypes.push({
            tag: tag,
            depth: depth,
            lineCount: blockText.split("\n").length,
            listType: listType,
            listStart: listStart,
            pills: blockPills,
            bolds: blockBolds.length > 0 ? blockBolds : null
          });
        }
      }
      if (blocks.length > 0) return blocks.join("\n");
    }

    // Single-block selection
    var blockText = JR.plainText(startBlock);
    if (!blockText) return null;
    var blockHasMath = !!startBlock.querySelector(JR.site.mathSelector);

    if (isCodeBlock(startBlock)) {
      var code = codeLines(startBlock, range);
      if (blockTypes && code) blockTypes.push({ tag: "PRE", depth: 0, lineCount: code.split("\n").length, pills: [], bolds: null });
      return code || null;
    }

    var startOffset = JR.getOffsetInBlock(startBlock, range.startContainer, range.startOffset);
    var endOffset = Math.min(
      blockText.length,
      JR.getOffsetInBlock(startBlock, range.endContainer, range.endOffset)
    );

    var sentStart = 0;
    for (var i = startOffset - 1; i >= 0; i--) {
      if (endsSentence(blockText, i, blockHasMath)) {
        sentStart = i + 1;
        break;
      }
    }

    var sentEnd = blockText.length;
    for (var j = endOffset; j < blockText.length; j++) {
      if (endsSentence(blockText, j, blockHasMath)) {
        sentEnd = j + 1;
        break;
      }
    }

    var sentence = blockText.slice(sentStart, sentEnd).trim();

    if (blockTypes && sentence) {
      var singleExtracted = JR.extractBlockText(startBlock);
      var closestLI = startBlock.closest("li");
      var isFirstBlk = !closestLI || startBlock === closestLI || closestLI.firstElementChild === startBlock;
      var isFirstSentence = closestLI && isFirstBlk && sentStart === 0;

      var blockLeadWS = blockText.length - blockText.trimStart().length;
      var rawSlice = blockText.slice(sentStart, sentEnd);
      var sentLeadWS = rawSlice.length - rawSlice.trimStart().length;
      var rangeOffset = blockLeadWS - sentStart - sentLeadWS;

      var sentPills = [];
      var sentBolds = [];
      var singleRangeSets = [
        { src: singleExtracted.pills, dst: sentPills },
        { src: singleExtracted.bolds, dst: sentBolds }
      ];
      for (var rs = 0; rs < singleRangeSets.length; rs++) {
        var srcR = singleRangeSets[rs].src;
        var dstR = singleRangeSets[rs].dst;
        for (var pi = 0; pi < srcR.length; pi++) {
          var adjS = srcR[pi].start + rangeOffset;
          var adjE = srcR[pi].end + rangeOffset;
          if (adjE > 0 && adjS < sentence.length) {
            dstR.push({ start: Math.max(0, adjS), end: Math.min(sentence.length, adjE) });
          }
        }
      }

      if (sentPills.length > 0 && sentPills[0].start === 0) {
        var trimResult = trimLeadingPills(sentence, sentPills, sentBolds);
        sentence = trimResult.text;
        sentPills = trimResult.pills;
        sentBolds = trimResult.bolds;
      }

      var hasMeta = isFirstSentence || sentPills.length > 0 || sentBolds.length > 0;
      if (hasMeta) {
        var singleDepth = 0;
        var singleListType = "ul";
        var singleListStart = 1;
        if (closestLI) {
          var singleAnc = startBlock.parentElement;
          while (singleAnc && singleAnc !== container) {
            if (singleAnc.tagName === "UL" || singleAnc.tagName === "OL") {
              if (singleDepth === 0) {
                singleListType = singleAnc.tagName === "OL" ? "ol" : "ul";
                if (singleAnc.tagName === "OL") {
                  var singleOrd = 1;
                  var sPrev = closestLI.previousElementSibling;
                  while (sPrev) {
                    if (sPrev.tagName === "LI") singleOrd++;
                    sPrev = sPrev.previousElementSibling;
                  }
                  singleListStart = singleOrd;
                }
              }
              singleDepth++;
            }
            singleAnc = singleAnc.parentElement;
          }
        }
        blockTypes.push({
          tag: isFirstSentence ? "LI" : startBlock.tagName,
          depth: singleDepth,
          lineCount: sentence.split("\n").length,
          listType: singleListType,
          listStart: singleListStart,
          pills: sentPills.length > 0 ? sentPills : null,
          bolds: sentBolds.length > 0 ? sentBolds : null
        });
      }
    }

    return sentence || null;
  };

  /**
   * Extract sentence context for a selection in an AI response article.
   * Thin wrapper around extractSentenceInContainer.
   */
  JR.extractSentence = function (range, blockTypes) {
    var article = JR.getAIResponseArticle(
      range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement
        : range.startContainer
    );
    if (!article) return null;
    return JR.extractSentenceInContainer(range, blockTypes, article);
  };

  /**
   * Quick selection check — returns basic selection info without expensive
   * sentence extraction. Used to show the trigger button instantly.
   * Sentence extraction is deferred to when the trigger is clicked.
   */
  JR.getSelectedTextQuick = function () {
    if (!JR.site.isChatPage()) return null; // R8: no Popup button outside chats
    var selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;

    var sel = JR.selectionText(selection); // formulas once, not 3 times as in selection.toString()
    var range = sel.range;
    var text = sel.text;
    if (!text) return null;

    var anchorEl =
      selection.anchorNode.nodeType === Node.TEXT_NODE
        ? selection.anchorNode.parentElement
        : selection.anchorNode;
    var focusEl =
      selection.focusNode.nodeType === Node.TEXT_NODE
        ? selection.focusNode.parentElement
        : selection.focusNode;

    if (!anchorEl || !focusEl) return null;
    if (JR.isInsideChatInput(anchorEl) || JR.isInsideChatInput(focusEl)) return null;
    if (JR.isInsidePopup(anchorEl) || JR.isInsidePopup(focusEl)) return null;

    var anchorArticle = JR.getAIResponseArticle(anchorEl);
    var focusArticle = JR.getAIResponseArticle(focusEl);
    if (!anchorArticle || !focusArticle) return null;
    if (anchorArticle !== focusArticle) return null;

    var rect = range.getBoundingClientRect();
    return { text: text, sentence: null, blockTypes: null, rect: rect, article: anchorArticle, range: range };
  };

  /** Elements that make their ancestor block not the innermost one. */
  var innerBlockSel = null;
  function innerBlockSelector() {
    return innerBlockSel || (innerBlockSel = Array.from(BLOCK_TAGS).join(", ") + ", " + JR.site.codeBlockSelector);
  }

  /** A code block counts as one block for sentence extraction (old <pre> or current [data-code-block]). */
  function isCodeBlock(node) {
    return node.tagName === "PRE" || !!(node.matches && node.matches(JR.site.codeBlockSelector));
  }

  /**
   * The whole lines of a code block that a range touches (all lines if it covers the
   * block), without the toolbar; indentation kept.
   */
  function codeLines(block, range) {
    var src = (block.tagName === "PRE" ? block : block.querySelector(JR.site.codeSourceSelector)) || block;
    var text = JR.site.codeText(src);
    var from = 0, to = text.length;
    var cm = JR.site.codeLineEls(src);
    if (cm.length) {
      var hit = [];
      for (var i = 0; i < cm.length; i++) if (range.intersectsNode(cm[i])) hit.push(i);
      if (hit.length) text = text.split("\n").slice(hit[0], hit[hit.length - 1] + 1).join("\n");
    } else {
      if (src.contains(range.startContainer)) from = JR.getOffsetInBlock(src, range.startContainer, range.startOffset);
      if (src.contains(range.endContainer)) to = JR.getOffsetInBlock(src, range.endContainer, range.endOffset);
      var a = text.lastIndexOf("\n", from - 1) + 1, b = text.indexOf("\n", Math.max(from, to - 1));
      text = text.slice(a, b === -1 ? text.length : b);
    }
    return text.replace(/^\n+|\s+$/g, "");
  }

  /**
   * Check if a text node is inside a ChatGPT code block toolbar
   * (the bar with language label, copy, run buttons).
   * These elements are inside .contain-inline-size but outside <pre>/<code>.
   */
  function isToolbarTextNode(textNode) {
    var parent = textNode.parentElement;
    if (!parent) return false;
    // Current ChatGPT: code lives in [data-code-block-source]; the rest of the block is toolbar
    var cb = parent.closest(JR.site.codeBlockSelector);
    if (cb && cb.tagName !== "PRE") return !parent.closest(JR.site.codeSourceSelector);
    // If inside <pre> or <code>, it's actual code — keep it
    if (parent.closest("pre") || parent.closest("code")) return false;
    // If inside .contain-inline-size but NOT inside pre/code, it's toolbar
    if (parent.closest(".contain-inline-size")) return true;
    return false;
  }

  // Collect text nodes by simple concatenation (no block-boundary markers).
  // A formula is one entry: its element, with its TeX source as text (JR.mathText);
  // with visibleMath, its on-screen text nodes instead (see JR.selectionText).
  function collectTextNodes(walkerRoot, skipFn, visibleMath) {
    var nodes = [];
    var fullText = "";
    (function walk(n) {
      for (var c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === Node.TEXT_NODE) {
          if (isToolbarTextNode(c) || (skipFn && skipFn(c))) continue;
          nodes.push({ node: c, start: fullText.length, text: c.data });
          fullText += c.data;
        } else if (c.nodeType === Node.ELEMENT_NODE) {
          if (c.matches(JR.site.hiddenMathSelector) || c.matches(JR.site.hiddenTextSelector)) continue;
          if (c.matches(JR.site.mathSelector) && !visibleMath) {
            var t = JR.mathText(c);
            nodes.push({ node: c, start: fullText.length, text: t, math: true });
            fullText += t;
          } else {
            walk(c);
          }
        }
      }
    })(walkerRoot);
    return { nodes: nodes, fullText: fullText };
  }

  /** Start of the nth (0-based) exact occurrence of s in text, or -1. */
  function nthIndexOf(text, s, nth) {
    var i = text.indexOf(s);
    for (var k = 0; k < nth && i !== -1; k++) i = text.indexOf(s, i + 1);
    return i;
  }

  /**
   * Which occurrence of `text` (0-based) inside root starts at the text node
   * `firstNode`: saved with a highlight so a word that appears several times
   * is restored at the right one, not the first.
   */
  JR.occurrenceIndex = function (root, firstNode, text) {
    if (!root || !firstNode || !text) return 0;
    // Same rule as JR.findTextRange: the TeX text first, if the nth match there
    // is this highlight; otherwise the on-screen text (part of a formula).
    var n = countBefore(root, firstNode, text, false);
    var r = findTextRangeIn(root, text, n, false);
    if (r && r.intersectsNode(firstNode)) return n;
    return countBefore(root, firstNode, text, true);
  };

  function countBefore(root, firstNode, text, visibleMath) {
    var map = collectTextNodes(root, null, visibleMath);
    var start = -1;
    for (var i = 0; i < map.nodes.length; i++) {
      var e = map.nodes[i];
      if (e.node === firstNode || (e.math && e.node.contains(firstNode))) { start = e.start; break; }
    }
    if (start < 0) return 0;
    var n = 0;
    for (var at = map.fullText.indexOf(text); at !== -1 && at < start; at = map.fullText.indexOf(text, at + 1)) n++;
    return n;
  }

  /**
   * Range of searchText inside root. nth: which exact occurrence to use
   * (JR.occurrenceIndex); the first one if there are fewer. Formulas count as
   * their TeX source and are covered whole.
   */
  JR.findTextRange = function (root, searchText, nth) {
    // Formulas as TeX first; a selection of part of a formula was saved as shown on screen.
    return findTextRangeIn(root, searchText, nth, false)
      || (root.querySelector(JR.site.mathSelector) ? findTextRangeIn(root, searchText, nth, true) : null);
  };

  function findTextRangeIn(root, searchText, nth, visibleMath) {
    var map = collectTextNodes(root, null, visibleMath);
    var nodes = map.nodes;
    var fullText = map.fullText;

    if (nodes.length === 0) return null;

    var idx = nth > 0 ? nthIndexOf(fullText, searchText, nth) : -1;
    if (idx === -1) idx = fullText.indexOf(searchText);

    // Fallback: selection.toString() inserts \n at block boundaries differently
    // than DOM text nodes. Strip all \n from both strings and search with a
    // position map back to the original fullText offsets.
    var newlineMatched = false;
    if (idx === -1 && searchText.indexOf("\n") !== -1) {
      var strippedFull = "";
      var posMap = []; // posMap[strippedIndex] = originalIndex
      for (var p = 0; p < fullText.length; p++) {
        if (fullText[p] !== "\n") {
          posMap.push(p);
          strippedFull += fullText[p];
        }
      }
      var strippedSearch = searchText.replace(/\n/g, "");
      var sIdx = strippedFull.indexOf(strippedSearch);
      if (sIdx !== -1) {
        idx = posMap[sIdx];
        var origEnd = posMap[sIdx + strippedSearch.length - 1] + 1;
        newlineMatched = true;
        // Use origEnd directly instead of idx + searchText.length
      }
    }

    // Fallback: normalize all whitespace (spaces, tabs, nbsp) to single space
    // and retry. Handles CJK text where selection.toString() may insert spaces
    // at element boundaries that don't exist in DOM text nodes.
    if (idx === -1) {
      var wsNorm = function (s) { return s.replace(/[\s\u00a0]+/g, " ").trim(); };
      var normFull = wsNorm(fullText);
      var normSearch = wsNorm(searchText);
      // Build position map from normalized to original
      var wsMap = [];
      var ni = 0;
      for (var wi = 0; wi < fullText.length; wi++) {
        if (ni < normFull.length && normFull[ni] === fullText[wi]) {
          wsMap.push(wi);
          ni++;
        } else if (/[\s\u00a0]/.test(fullText[wi])) {
          // Whitespace char in original — skip unless it maps to the normalized space
          if (ni < normFull.length && normFull[ni] === " " && /[\s\u00a0]/.test(fullText[wi])) {
            wsMap.push(wi);
            ni++;
          }
        }
      }
      var wsIdx = normFull.indexOf(normSearch);
      if (wsIdx !== -1 && wsIdx < wsMap.length) {
        var wsEndIdx = wsIdx + normSearch.length;
        idx = wsMap[wsIdx];
        var origEnd = wsEndIdx <= wsMap.length ? wsMap[wsEndIdx - 1] + 1 : idx + searchText.length;
        newlineMatched = true; // reuse the origEnd path
      }
    }

    // Fallback: case-insensitive match (selection may have captured different casing
    // than what's rendered, e.g. CSS text-transform or rich text normalization)
    if (idx === -1) {
      idx = fullText.toLowerCase().indexOf(searchText.toLowerCase());
      if (idx !== -1) {
        // Use the DOM text length (might differ in case but same chars)
        newlineMatched = false;
      }
    }

    // Fallback: try trimmed searchText (selection sometimes captures trailing/leading spaces)
    if (idx === -1) {
      var trimmed = searchText.trim();
      if (trimmed.length > 0 && trimmed !== searchText) {
        idx = fullText.indexOf(trimmed);
        if (idx !== -1) {
          searchText = trimmed;
          newlineMatched = false;
        }
      }
    }

    // If not found, toolbar text inside <code> may be inflating the text.
    if (idx === -1) {
      var skipNodes = new Set();
      var codeEls = root.querySelectorAll("code");
      for (var ci = 0; ci < codeEls.length; ci++) {
        var codeFullText = codeEls[ci].textContent;
        var tbMatch = codeFullText.match(/^([A-Z][a-zA-Z+#.]*?)?(Copy code|Copied!|Copy|Run)+/);
        if (!tbMatch) continue;
        var tbLen = tbMatch[0].length;
        var consumed = 0;
        var codeWalker = document.createTreeWalker(codeEls[ci], NodeFilter.SHOW_TEXT, null);
        var tn;
        while ((tn = codeWalker.nextNode()) && consumed < tbLen) {
          var tnLen = tn.textContent.length;
          if (consumed + tnLen <= tbLen) {
            skipNodes.add(tn);
          }
          consumed += tnLen;
        }
      }

      var map2 = collectTextNodes(root, function (n3) { return skipNodes.has(n3); }, visibleMath);
      nodes = map2.nodes;
      fullText = map2.fullText;

      idx = fullText.indexOf(searchText);
      // Try whitespace-normalized match on toolbar-stripped text
      if (idx === -1) {
        var wsNorm2 = function (s) { return s.replace(/[\s\u00a0]+/g, " ").trim(); };
        var normFull2 = wsNorm2(fullText);
        var normSearch2 = wsNorm2(searchText);
        var wsIdx2 = normFull2.indexOf(normSearch2);
        // Also try case-insensitive
        if (wsIdx2 === -1) wsIdx2 = normFull2.toLowerCase().indexOf(normSearch2.toLowerCase());
        if (wsIdx2 !== -1) {
          // Rebuild position map for this stripped fullText
          var wsMap2 = [];
          var ni2 = 0;
          for (var wi2 = 0; wi2 < fullText.length && ni2 < normFull2.length; wi2++) {
            if (normFull2[ni2] === fullText[wi2]) { wsMap2.push(wi2); ni2++; }
            else if (/[\s\u00a0]/.test(fullText[wi2]) && normFull2[ni2] === " ") { wsMap2.push(wi2); ni2++; }
          }
          if (wsIdx2 < wsMap2.length) {
            var wsEnd2 = wsIdx2 + normSearch2.length;
            idx = wsMap2[wsIdx2];
            var origEnd = wsEnd2 <= wsMap2.length ? wsMap2[wsEnd2 - 1] + 1 : idx + searchText.length;
            newlineMatched = true;
          }
        }
      }
      if (idx === -1) return null;
    }

    var endIdx = newlineMatched ? origEnd : idx + searchText.length;
    var start = null, startOffset = 0;
    var end = null, endOffset = 0;

    for (var i = 0; i < nodes.length; i++) {
      var nodeStart = nodes[i].start;
      var nodeEnd = nodeStart + nodes[i].text.length;

      if (start === null && idx < nodeEnd) {
        start = nodes[i];
        startOffset = idx - nodeStart;
      }

      if (endIdx <= nodeEnd) {
        end = nodes[i];
        endOffset = endIdx - nodeStart;
        break;
      }
    }

    if (!start || !end) return null;
    // Text found inside a formula's TeX but not covering the formula whole came
    // from a selection of part of it, saved as shown: match on screen text instead.
    if ((start.math && startOffset > 0) || (end.math && endOffset < end.text.length)) return null;

    var range = document.createRange();
    if (start.math) range.setStartBefore(start.node); else range.setStart(start.node, startOffset);
    if (end.math) range.setEndAfter(end.node); else range.setEnd(end.node, endOffset);
    return range;
  }
})();

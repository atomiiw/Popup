// dom-helpers.js — DOM query and utility functions
(function () {
  "use strict";

  /**
   * Check if a node is inside an AI response turn (not a user turn).
   * Returns the article element if yes, null otherwise.
   */
  JR.getAIResponseArticle = function (node) {
    // Must be inside the assistant part: a new-DOM turn also contains the user's question.
    var unit = JR.site.assistantUnitOf(node);
    if (!unit) return null;
    return JR.site.turnOf(unit) || unit;
  };

  /**
   * Check if a node is inside the chat input area.
   */
  JR.isInsideChatInput = function (node) {
    var composer = JR.site.composer();
    return !!(composer && composer.contains(node));
  };

  /**
   * Check if ChatGPT is currently generating a response.
   * The stop button is present ONLY during active generation.
   */
  JR.isGenerating = function () {
    // The stop button can disappear before ChatGPT is really done (e.g. it is
    // still producing a second answer version); an open Popup response stream
    // (net-tap.js) also counts, or the next queued question gets rejected.
    return JR.site.isGenerating() || JR.state.netActive > 0;
  };

  /**
   * Check if a node is inside our popup.
   */
  JR.isInsidePopup = function (node) {
    return !!node.closest(".jr-popup");
  };

  /** True for text inside a formula's invisible screen-reader copy. */
  JR.isHiddenMath = function (node) {
    var el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    return !!(el && el.closest && el.closest(JR.site.hiddenMathSelector));
  };

  /**
   * A formula as Popup's text: its TeX source as \(…\) (\[…\] for display
   * math) — the same form ChatGPT's own "Ask ChatGPT" quotes it in.
   */
  JR.mathText = function (el) {
    var tex = el.querySelector(JR.site.mathTexSelector);
    if (!tex) return (el.querySelector(JR.site.mathVisibleSelector) || el).textContent;
    // Line breaks in multi-line TeX would read as block breaks in the quote; TeX ignores them.
    var src = tex.textContent.replace(/\s+/g, " ").trim();
    return el.closest(JR.site.mathDisplaySelector) ? "\\[" + src + "\\]" : "\\(" + src + "\\)";
  };

  /**
   * Text of a node as Popup uses it: like textContent, with each formula as
   * its TeX source (JR.mathText). With blockBreaks, a line break separates
   * block elements (as selection.toString() does).
   */
  JR.plainText = function (root, blockBreaks) {
    return textIn(root, null, blockBreaks, false);
  };

  /** A popup answer's text (for "Reply"), without Popup's own Reply button and code headers. */
  JR.popupResponseText = function (responseDiv) {
    var copy = responseDiv.cloneNode(true);
    copy.querySelectorAll(".jr-reply-whole-btn, .jr-code-header").forEach(function (el) { el.remove(); });
    return textIn(copy, null, true, false).trim();
  };

  /**
   * The text a selection stands for. A formula it covers whole is its TeX
   * source; if it covers only part of some formula (one letter, a subscript),
   * the selection is taken as shown on screen, so it stays exactly what the
   * user picked. Returns { range, text }.
   */
  JR.selectionText = function (selection) {
    var range = selection.getRangeAt(0).cloneRange();
    var maths = touchedMath(range);
    if (!maths.length) return { range: range, text: selection.toString().trim() };
    var partial = maths.some(function (m) { return !coversMath(range, m); });
    // A selection entirely inside one formula: read from the formula itself.
    var root = range.commonAncestorContainer;
    if (maths.length === 1 && maths[0].contains(root)) root = maths[0];
    return { range: range, text: textIn(root, range, true, partial).trim() };
  };

  /** Formulas a range touches (including one that contains the whole range). */
  function touchedMath(range) {
    var root = range.commonAncestorContainer;
    var el = root.nodeType === Node.TEXT_NODE ? root.parentElement : root;
    if (!el) return [];
    var outer = el.closest(JR.site.mathSelector);
    if (outer) return [outer];
    return Array.prototype.filter.call(el.querySelectorAll(JR.site.mathSelector), function (m) { return range.intersectsNode(m); });
  }

  /**
   * Does the selection cover the whole formula? Compared by its on-screen
   * characters: a drag from the formula's first to last character ends inside
   * it (on text nodes), not around the element.
   */
  function coversMath(range, math) {
    var r = document.createRange();
    r.selectNode(math);
    if (range.compareBoundaryPoints(Range.START_TO_START, r) <= 0 && range.compareBoundaryPoints(Range.END_TO_END, r) >= 0) return true;
    var vis = math.querySelector(JR.site.mathVisibleSelector);
    if (!vis) return false;
    var squash = function (t) { return t.replace(/\s+/g, ""); };
    return squash(textIn(vis, range, false, true)) === squash(vis.textContent);
  }

  // visibleMath: formulas as their on-screen characters (the hidden copy skipped)
  // instead of their TeX source.
  function textIn(root, range, blockBreaks, visibleMath) {
    var out = "";
    (function walk(n) {
      if (range && !range.intersectsNode(n)) return;
      if (n.nodeType === Node.TEXT_NODE) {
        var a = range && n === range.startContainer ? range.startOffset : 0;
        var b = range && n === range.endContainer ? range.endOffset : n.data.length;
        out += n.data.slice(a, b);
        return;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      if (n.matches(JR.site.mathSelector) && !visibleMath) { out += JR.mathText(n); return; }
      if (n.matches(JR.site.hiddenMathSelector) || n.matches(JR.site.hiddenTextSelector)) return;
      if (blockBreaks && JR.BLOCK_TAGS.has(n.tagName) && out && out[out.length - 1] !== "\n") out += "\n";
      for (var c = n.firstChild; c; c = c.nextSibling) walk(c);
    })(root);
    return out;
  }

  /** Offset of (container, offset) in JR.plainText(block). */
  JR.getOffsetInBlock = function (block, container, offset) {
    var r = document.createRange();
    r.setStart(block, 0);
    r.setEnd(container, offset);
    return textIn(block, r, false, false).length;
  };

  /**
   * Find the nearest scrollable ancestor of an element.
   * Requires actual scrollable content (scrollHeight > clientHeight)
   * to avoid picking up ancestors like <main> that have overflow:auto
   * but cover the full page (including header/input areas).
   */
  JR.getScrollParent = function (el) {
    var current = el.parentElement;
    while (current) {
      var style = getComputedStyle(current);
      var overflow = style.overflow + style.overflowY;
      if (/auto|scroll/.test(overflow) && current.scrollHeight > current.clientHeight + 10) {
        return current;
      }
      current = current.parentElement;
    }
    return document.documentElement;
  };

  /**
   * Stable key of the turn containing an element (see JR.site.turnKey), or null.
   */
  JR.getTurnKey = function (el) {
    if (!el) return null;
    var turn = el.matches && el.matches(JR.SEL.turn) ? el : JR.site.turnOf(el);
    return JR.site.turnKey(turn);
  };

  JR.truncateText = function (text, max) {
    if (text.length <= max) return text;
    return text.slice(0, max) + "\u2026";
  };

})();

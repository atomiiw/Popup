// dom-helpers.js — DOM query and utility functions for Jump Return
(function () {
  "use strict";

  var S = JR.SELECTORS;

  /**
   * Check if a node is inside an AI response turn (not a user turn).
   * Returns the article element if yes, null otherwise.
   */
  JR.getAIResponseArticle = function (node) {
    var article = node.closest(S.aiTurn);
    if (!article) return null;
    var label = article.querySelector(S.aiLabel);
    if (!label || !label.textContent.includes(JR.AI_LABEL_TEXT)) return null;
    return article;
  };

  /**
   * Check if a node is inside the chat input area.
   */
  JR.isInsideChatInput = function (node) {
    return !!node.closest(S.chatInput);
  };

  /**
   * Check if ChatGPT is currently generating a response.
   * The stop button is present ONLY during active generation.
   */
  JR.isGenerating = function () {
    return !!document.querySelector(S.stopButton);
  };

  /**
   * Check if a node is inside our popup.
   */
  JR.isInsidePopup = function (node) {
    return !!node.closest(".jr-popup");
  };

  /**
   * Walk up from a node to find the nearest block-level ancestor,
   * stopping before the ceiling element.
   */
  JR.findBlockAncestor = function (node, ceiling) {
    var el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (el && el !== ceiling) {
      if (JR.BLOCK_TAGS.has(el.tagName)) return el;
      el = el.parentElement;
    }
    return null;
  };

  /**
   * Get the character offset of a (container, offset) position within a block's textContent.
   */
  JR.getOffsetInBlock = function (block, container, offset) {
    var r = document.createRange();
    r.setStart(block, 0);
    r.setEnd(container, offset);
    return r.toString().length;
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
   * Extract the turn number from an article's data-testid attribute.
   * e.g. "conversation-turn-5" → 5
   */
  JR.getTurnNumber = function (article) {
    var testId = article.getAttribute("data-testid") || "";
    var match = testId.match(/conversation-turn-(\d+)/);
    return match ? parseInt(match[1], 10) : -1;
  };

  JR.getModeLabel = function (mode) {
    return mode === "regular" ? "Elaborate" : "Brief";
  };

  JR.truncateText = function (text, max) {
    if (text.length <= max) return text;
    return text.slice(0, max) + "\u2026";
  };
})();

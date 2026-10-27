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

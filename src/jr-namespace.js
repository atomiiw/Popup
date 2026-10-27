// jr-namespace.js — Shared namespace, constants, and mutable state
(function () {
  "use strict";

  window.JR = {
    // --- Constants ---
    // ChatGPT DOM selectors live in src/site-adapter.js (JR.site / JR.SEL) — nowhere else.

    MAX_DISPLAY_CHARS: 120,

    BLOCK_TAGS: new Set([
      "P", "LI", "H1", "H2", "H3", "H4", "H5", "H6",
      "PRE", "BLOCKQUOTE", "TD", "TH",
    ]),

    SENTENCE_TERMINATORS: [".", "?", "!", "\u3002", "\uFF1F", "\uFF01"],

    // --- Shared mutable state ---
    state: {
      activePopup: null,
      responseMode: "medium",           // "medium" or "concise"
      cancelResponseWatch: null,
      responseWatchActive: false,       // true while waitForResponse is polling (including detached)
      activeSourceHighlights: [],       // wrapper <span> elements in the AI response
      resizeHandler: null,              // window resize listener
      completedHighlights: new Map(),   // quoteId → { quoteId, spans, text, sentence, items: [{id, question, responseHTML, ...}], activeItemIndex, ... }
      activeHighlightId: null,          // current popup's highlight id (for chaining)
      popupStack: [],                   // saved parent popup states for nested chains
      lastKnownUrl: location.href,
      customPopupWidthL1: null,         // session-persisted width for level-1 popups
      customPopupWidthChained: null,    // session-persisted width for chained (level 2+) popups
      confirmingDelete: false,          // true while delete confirmation is showing
      navWidget: null,                  // floating highlight navigation widget element
      messageQueue: [],                  // queued messages waiting for generation to finish
      watchingTurnKey: null,              // turn key of the Q&A currently being captured
      lastSendReport: null,               // outcome of the last injection (for JR.diagnose)
    },
  };
})();

// site-hosts.js — What Popup must know about a site before its site layer loads: early-hide.js runs at
// document_start, storage.js before the site layers. Per site: the storage key prefix, the conversation id in
// the URL, and the CSS that hides a Popup Q&A (hide(k) must match the site layer's turnSelector(k) for a real
// key — tested in tools/dom-test.html "Step 4a").
var JR_HOST = (function () {
  "use strict";
  var UUID = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";
  function q(k) { return String(k).replace(/["\\]/g, ""); }
  var all = {
    chatgpt: {
      prefix: "popup:conv:", // since 1.2.0, unchanged (no migration)
      conv: new RegExp("/c/" + UUID, "i"),
      hide: function (k) {
        var legacy = /^legacy-(\d+)$/.exec(k);
        return legacy ? '[data-testid="conversation-turn-' + legacy[1] + '"]' : '[data-turn-key="' + q(k) + '"]';
      },
      // Not display:none: a 0×0 turn makes ChatGPT's list re-create the turns above as placeholders on the next send (R36a)
      decl: "height: 0 !important; min-height: 0 !important; padding: 0 !important; margin: 0 !important; border: 0 !important; overflow: clip !important; visibility: hidden !important; pointer-events: none !important;",
    },
    deepseek: {
      prefix: "popup:deepseek:conv:",
      conv: new RegExp("/chat/s/" + UUID, "i"),
      hide: function (k) { // the answer item and the user item before it
        var s = '[data-virtual-list-item-key="' + q(k) + '"]';
        // The user item also by its id (answer id − 1): DeepSeek may mount it without its answer (end of its window,
        // live 2026-11-18). shortcut: assumes the question right before (Popup sends, never regenerates); a native
        // regenerate of a Popup answer would hide the item before it instead — then key the question id too.
        var prev = /^\d+$/.test(k) ? ', [data-virtual-list-item-key="' + (Number(k) - 1) + '"]' : "";
        return s + ", [data-virtual-list-item-key]:has(+ " + s + ")" + prev;
      },
      // Not display:none: DeepSeek's list measures items with a ResizeObserver, which never reports an item that is
      // not rendered — those keep its size estimate, and a run of them filled its window: newer messages were never
      // drawn, a blank screen at the bottom (live 2026-11-18, 13 hidden in a row). Height 0 with the width kept is
      // measured as 0 (as on ChatGPT, R36a).
      decl: "height: 0 !important; min-height: 0 !important; padding: 0 !important; margin: 0 !important; border: 0 !important; overflow: clip !important; visibility: hidden !important; pointer-events: none !important;",
    },
    claude: {
      prefix: "popup:claude:conv:",
      conv: new RegExp("/chat/" + UUID, "i"),
      hide: function (k) { // both rows of the Q&A
        return '[data-testid=transcript-row]:has([data-cds=UserMessage][data-turn-key="' + q(k) + '"]), ' +
               '[data-testid=transcript-row]:has([data-cds=AssistantMessage][data-turn-key="' + q(k) + '-hub-reply"])';
      },
      // Never display:none: rocksteady skips 0×0 rows and keeps their old height → blank screens while scrolling (C2)
      decl: "height: 0 !important; min-height: 0 !important; overflow: hidden !important; pointer-events: none !important;",
    },
  };
  var h = location.hostname;
  var name = /(^|\.)chat\.deepseek\.com$/.test(h) ? "deepseek" : /(^|\.)claude\.ai$/.test(h) ? "claude" : "chatgpt";
  var here = all[name];
  return {
    name: name,
    all: all,
    hide: here.hide,
    decl: here.decl,
    /** Storage key of the conversation at url (another page's URL than this one's: "url:…"). */
    convKey: function (url) {
      var m = here.conv.exec(url || location.href);
      return here.prefix + (m ? m[1] : "url:" + (url || location.href).split("#")[0]);
    },
    convId: function (url) { var m = here.conv.exec(url || location.pathname); return m ? m[1] : null; },
  };
})();

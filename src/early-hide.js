// early-hide.js — Runs at document_start to hide Popup Q&A turns before they paint.
// Reads this conversation's stored turn keys and injects display:none rules.
// Must stay in sync with JR.site.turnSelector() (site-adapter.js) and the
// storage key format in storage.js.
(function () {
  "use strict";

  var m = /\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(location.pathname);
  if (!m) return;
  var key = "popup:conv:" + m[1];

  chrome.storage.local.get(key, function (result) {
    var doc = result[key];
    if (!doc) return;
    var keys = (doc.hidden || []).slice();
    (doc.items || []).forEach(function (it) {
      (it.turnKeys || []).forEach(function (k) { keys.push(k); });
    });
    if (keys.length === 0) return;

    var rules = [];
    keys.forEach(function (k) {
      var legacy = /^legacy-(\d+)$/.exec(k);
      if (legacy) { rules.push('[data-testid="conversation-turn-' + legacy[1] + '"]'); return; }
      var key = String(k).replace(/["\\]/g, "");
      rules.push('[data-turn-key="' + key + '"]');
      // its virtualizer slot, only if the slot holds no other turn (see turnSlotSelector)
      rules.push('[style*="height"]:has(> [data-turn-key="' + key + '"]):not(:has(> [data-turn-key]:not([data-turn-key="' + key + '"])))');
    });
    var style = document.createElement("style");
    style.id = "jr-early-hide";
    style.textContent = rules.join(",\n") + " { display: none !important; }";
    (document.head || document.documentElement).appendChild(style);
  });
})();

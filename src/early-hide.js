// early-hide.js — Runs at document_start to hide Popup Q&A turns before they paint.
// Reads this conversation's stored turn keys and injects display:none rules.
// Must stay in sync with JR.site.turnSelector() (site-adapter.js) and the
// storage key format in storage.js.
(function () {
  "use strict";

  // Debug (#jr-evlog, read from #jr-evlog[data-json]): where a paste or a file drag goes. Registered here,
  // before ChatGPT's own scripts, so the "capture" entries see each event first; "bubble" entries only
  // appear if nobody stopped it on the way. Popup's own handlers add "popup" entries (attachments.js).
  if (location.hash.indexOf("jr-evlog") !== -1) {
    var lastOver = { capture: 0, bubble: 0 };
    var evlog = window.jrEvLog = function (type, phase, e, extra) {
      var el = document.getElementById("jr-evlog");
      if (!el) { el = document.createElement("div"); el.id = "jr-evlog"; el.hidden = true; document.documentElement.appendChild(el); }
      var t = e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement;
      var a = document.activeElement, dt = e.clipboardData || e.dataTransfer;
      var log = JSON.parse(el.getAttribute("data-json") || "[]");
      log.push({ t: Math.round(performance.now()), type: type, phase: phase, prevented: e.defaultPrevented,
        target: t ? t.tagName + "." + String(t.className).slice(0, 50) : null, inPopup: !!(t && t.closest && t.closest(".jr-popup")),
        active: a ? a.tagName + "." + String(a.className).slice(0, 50) : null,
        types: dt ? Array.prototype.slice.call(dt.types || []) : null, files: dt && dt.files ? dt.files.length : null,
        text: dt && dt.getData ? (dt.getData("text/plain") || "").length : null, extra: extra || null });
      el.setAttribute("data-json", JSON.stringify(log.slice(-80)));
    };
    window.addEventListener("error", function (e) { // an error in Popup's own scripts (this world)
      evlog("error", "window", e, { msg: String(e.message).slice(0, 200), at: (e.filename || "").split("/").pop() + ":" + e.lineno, stack: e.error && String(e.error.stack).slice(0, 400) });
    });
    ["paste", "dragenter", "dragover", "dragleave", "drop"].forEach(function (type) {
      [true, false].forEach(function (capture) {
        window.addEventListener(type, function (e) {
          var phase = capture ? "capture" : "bubble";
          if (type === "dragover") { // fires every few ms
            if (performance.now() - lastOver[phase] < 300) return;
            lastOver[phase] = performance.now();
          }
          evlog(type, phase, e);
        }, capture);
      });
    });
  }

  // Files dragged over a popup: Popup takes them before ChatGPT's scripts (registered later) can (attachments.js)
  ["dragenter", "dragover", "dragleave", "drop"].forEach(function (type) {
    window.addEventListener(type, function (e) { if (window.JR && window.JR.popupDrag) window.JR.popupDrag(e); }, true);
  });

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
      rules.push('[data-turn-key="' + key + '"]'); // the turn only, never its slot (see qa-content.js)
    });
    var style = document.createElement("style");
    style.id = "jr-early-hide";
    style.textContent = rules.join(",\n") + " { display: none !important; }";
    (document.head || document.documentElement).appendChild(style);
  });
})();

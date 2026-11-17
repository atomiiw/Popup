// deepseek.js — The ONLY place that knows DeepSeek's DOM (chat.deepseek.com). Step 4b.
//
// Implements the same JR.site interface as site-adapter.js does for ChatGPT, so the rest of Popup
// runs unchanged. Wired in by the Step 4a refactor (docs/DEEPSEEK.md): site-adapter.js picks
// JR.sites.deepseek when location.hostname is chat.deepseek.com.
//
// DeepSeek's DOM (probed 2026-11-17, docs/DEEPSEEK.md):
// - scroller .ds-virtual-list; mounted items in .ds-virtual-list-visible-items (translateY window,
//   ~14 items mounted around the screen); full-height parent .ds-virtual-list-items (popup host).
// - every message is its own item [data-virtual-list-item-key=<message id>]: a user item, then its
//   answer item. Ids are server message ids, NOT always consecutive (a regenerated answer skips one).
//   Just-sent messages carry temporary negative keys until a reload; the real ids come from the
//   reply's `ready` event (deepseek-net.js → jr-net "turn" {turnKey: answer id, userKey: question id}).
// - Popup's "turn" here is the ANSWER item, keyed by the answer's message id; the user item is the
//   one right before it (hidden with it via :has(+ …)).
(function () {
  "use strict";

  var C = {
    scroller: ".ds-virtual-list",
    list: ".ds-virtual-list-items",            // whole conversation height: never unmounted
    item: "[data-virtual-list-item-key]",
    answerBody: ".ds-assistant-message-main-content", // rendered answer (not DeepThink's reasoning)
    answerBodyFallback: ".ds-markdown",
    userText: ".ds-message",
    composer: ['textarea[name="search"]', "textarea"], // in this order: an edit box of an older message is a textarea too
    sendButton: '[role="button"].ds-button--primary',
    codeBlock: ".md-code-block",
    codeSource: "pre",
  };
  var KEY = "data-virtual-list-item-key";

  function isVisible(el) {
    return !!(el && el.isConnected && el.checkVisibility && el.checkVisibility());
  }
  function scroller() {
    var list = document.querySelectorAll(C.scroller);
    for (var i = 0; i < list.length; i++) if (isVisible(list[i])) return list[i];
    return null;
  }
  function root() { return scroller() || document; }
  function isAnswer(item) {
    return !!(item && item.querySelector(C.answerBody + ", " + C.answerBodyFallback));
  }
  /** Inside DeepThink's reasoning block: never shown in popups (user, 2026-11-17). */
  function inThinking(el, item) {
    for (var e = el.parentElement; e && e !== item; e = e.parentElement) if (/think/i.test(e.className)) return true;
    return false;
  }

  // Answer markup after a reload (no DeepSeek DOM to mirror): Popup's Markdown renderer, re-dressed in the
  // classes DeepSeek's own answer uses so DeepSeek's page CSS styles it the same. Measured 2026-11-17:
  // root .ds-markdown.ds-assistant-message-main-content, p.ds-markdown-paragraph, plain h3 / hr.
  // shortcut: code blocks, tables, lists, KaTeX classes still to be measured (B1) — add them here.
  var DS_CLASS = { P: "ds-markdown-paragraph" };

  // --- Temporary keys of just-sent messages → real ids (from jr-net "turn") ---
  var realOf = {};   // "-3" → "512"
  var tempsOf = {};  // "512" → ["-3"]
  function remember(temp, real) {
    if (temp == null || real == null) return;
    realOf[temp] = String(real);
    (tempsOf[real] = tempsOf[real] || []).push(String(temp));
  }
  // `ready` comes first in the reply, possibly before DeepSeek adds the answer item: keep the ids and map
  // on the next jr-net event that finds a new temporary ANSWER item (never a user item).
  var pending = null;
  document.addEventListener("jr-net", function (e) {
    var d; try { d = JSON.parse(e.detail); } catch (err) { return; }
    if (d.kind === "turn" && d.turnKey) pending = d;
    if (!pending) return;
    // The newest answer item with a temporary key is this reply's (sends are queued, one at a time)
    var answer = Array.prototype.slice.call(root().querySelectorAll(C.item)).filter(function (i) {
      return Number(i.getAttribute(KEY)) < 0 && !realOf[i.getAttribute(KEY)] && isAnswer(i);
    }).pop();
    if (!answer) return;
    remember(answer.getAttribute(KEY), pending.turnKey);
    var user = answer.previousElementSibling;
    if (user && pending.userKey && Number(user.getAttribute(KEY)) < 0) remember(user.getAttribute(KEY), pending.userKey);
    pending = null;
  });

  function itemSel(k) { return "[" + KEY + '="' + String(k).replace(/["\\]/g, "") + '"]'; }

  function textWithBreaks(el) {
    var out = "";
    (function walk(node) {
      for (var c = node.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) out += c.nodeValue;
        else if (c.nodeType === 1) {
          if (c.tagName === "BR") { out += "\n"; continue; }
          if (c.tagName === "BUTTON" || c.tagName === "svg" || c.getAttribute("role") === "button") continue;
          walk(c);
          if (/^(P|DIV|LI)$/.test(c.tagName) && out && out[out.length - 1] !== "\n") out += "\n";
        }
      }
    })(el);
    return out.replace(/\n{3,}/g, "\n\n").trim();
  }

  JR.sites = JR.sites || {};
  var S = JR.sites.deepseek = {
    name: "deepseek",

    // --- Turns (= answer items) ---
    turns: function () { return Array.prototype.slice.call(root().querySelectorAll(C.item)).filter(isAnswer); },
    turnOf: function (node) {
      var el = node && (node.nodeType === 3 ? node.parentElement : node);
      var item = el && el.closest && el.closest(C.item);
      if (!item) return null;
      if (isAnswer(item)) return item;
      var next = item.nextElementSibling; // a node in the user item: its answer
      return next && next.matches(C.item) && isAnswer(next) ? next : null;
    },
    /** The answer's real message id; a temporary key only once its real id is known (else null). */
    turnKey: function (turn) {
      if (!turn) return null;
      var k = turn.getAttribute(KEY);
      if (k == null) return null;
      if (Number(k) >= 0) return k;
      return realOf[k] || null;
    },
    /** CSS for the answer item with this key and the user item before it (also under its temporary key). */
    turnSelector: function (key) {
      if (!key) return null;
      var keys = [String(key)].concat(tempsOf[key] || []);
      return keys.map(function (k) { return itemSel(k) + ", " + C.item + ":has(+ " + itemSel(k) + ")"; }).join(", ");
    },
    findTurnByKey: function (key) {
      if (!key) return null;
      var r = root(), keys = [String(key)].concat(tempsOf[key] || []);
      for (var i = 0; i < keys.length; i++) {
        var el = r.querySelector(itemSel(keys[i]));
        if (el) return el;
      }
      return null;
    },

    // ChatGPT-only (hidden render frame, R34): DeepSeek can't be framed (frame-ancestors 'none')
    frameScroller: function () { return null; },
    frameTurn: function () { return null; },
    frameTurnCount: function () { return 0; },

    // --- Roles & bodies ---
    assistantUnitOf: function (node) {
      var el = node && (node.nodeType === 3 ? node.parentElement : node);
      var item = el && el.closest && el.closest(C.item);
      return item && isAnswer(item) ? item : null;
    },
    hasAssistant: function (turn) { return isAnswer(turn); },
    assistantBodies: function (turn) {
      if (!turn) return [];
      var b = Array.prototype.slice.call(turn.querySelectorAll(C.answerBody));
      if (!b.length) b = Array.prototype.slice.call(turn.querySelectorAll(C.answerBodyFallback));
      return b.filter(function (el) { return !inThinking(el, turn); });
    },
    hasUndrawnWidget: function () { return false; },
    renderFailed: function () { return false; },
    assistantHTML: function (turn) { return S.assistantBodies(turn).map(function (b) { return b.innerHTML; }).join(""); },
    assistantText: function (turn) { return S.assistantBodies(turn).map(function (b) { return b.textContent || ""; }).join("\n"); },
    /** The question: text of the user item right before the answer (it is mounted with it). */
    userText: function (turn) {
      var user = turn && turn.previousElementSibling;
      if (!user || !user.matches(C.item) || isAnswer(user)) return null;
      var body = user.querySelector(C.userText) || user;
      return textWithBreaks(body);
    },

    // --- Composer ---
    composer: function () {
      for (var s = 0; s < C.composer.length; s++) {
        var list = document.querySelectorAll(C.composer[s]);
        for (var i = 0; i < list.length; i++) if (isVisible(list[i])) return list[i];
      }
      return null;
    },
    composerText: function (composer) { return composer ? composer.value || "" : ""; },
    /** The box around the textarea that also holds the send button (no <form> on DeepSeek). */
    composerBox: function (composer) {
      for (var el = composer && composer.parentElement, n = 0; el && n < 8; el = el.parentElement, n++) {
        if (el.querySelector(C.sendButton)) return el;
      }
      return composer ? composer.parentElement : null;
    },
    sendButton: function (composer) {
      var box = S.composerBox(composer);
      var b = box && box.querySelector(C.sendButton);
      // a <div>: disabled shows only as aria-disabled or a "…disabled" class (aria-disabled was null on an empty box)
      var off = !b || b.getAttribute("aria-disabled") === "true" || /disabled/.test(b.className);
      return !off && isVisible(b) && !document.documentElement.hasAttribute("data-jr-ds-generating") ? b : null;
    },
    /** While DeepSeek answers, the same round button is the stop button. */
    stopButton: function () {
      if (!document.documentElement.hasAttribute("data-jr-ds-generating")) return null;
      var c = S.composer(), box = S.composerBox(c);
      return box && box.querySelector(C.sendButton);
    },
    isStopButton: function (node) {
      var b = S.stopButton();
      return !!(b && node && b.contains(node));
    },
    isGenerating: function () { return document.documentElement.hasAttribute("data-jr-ds-generating"); },
    // Attachments: DeepSeek's file cards not probed yet (docs/DEEPSEEK.md browser request B5)
    composerButtons: function (composer) {
      var box = S.composerBox(composer);
      return box ? Array.prototype.slice.call(box.querySelectorAll("[aria-label]")) : [];
    },
    composerHasAttachments: function () { return false; },
    attachmentsUploading: function () { return false; },

    // --- Layout ---
    scrollContainer: function () { return scroller() || document.scrollingElement; },
    /** Level-1 popups live in the full-height list: it is never unmounted. */
    popupHost: function (turn) {
      var list = (turn && turn.closest && turn.closest(C.list)) || root().querySelector(C.list);
      return list || scroller() || document.body;
    },
    chatColumn: function () { return scroller(); },
    /** On screen: from the scroller's top to the composer's top. */
    visibleBand: function () {
      var sc = scroller(), box = S.composerBox(S.composer());
      var top = sc ? sc.getBoundingClientRect().top : 0;
      var bottom = box ? box.getBoundingClientRect().top - 8 : window.innerHeight;
      return { top: top, bottom: Math.min(bottom, window.innerHeight) };
    },

    // --- Rich content ---
    codeBlocks: function (r) {
      return Array.prototype.map.call(r.querySelectorAll(C.codeBlock), function (b) {
        return { block: b, code: b.querySelector(C.codeSource) || b, lang: "" };
      });
    },
    codeBlockSelector: C.codeBlock + ", pre",
    codeSourceSelector: C.codeSource,
    codeLineEls: function () { return []; },
    codeText: function (src) { return src.textContent; },
    citationSelector: ":not(*)",
    noWrapSelector: "svg",
    chartPlotSelector: ":not(*)",
    noWrapHostSelector: ":not(*)",
    answerComponents: { block: [], inline: [], code: null },
    hiddenTextSelector: ":not(*)",
    chartContext: function () { return null; },
    strongSelector: "strong, b",
    entitySelector: ":not(*)",
    // KaTeX, like ChatGPT (to confirm live: browser request B4)
    mathSelector: ".katex",
    mathTexSelector: 'annotation[encoding="application/x-tex"]',
    mathVisibleSelector: ".katex-html",
    mathDisplaySelector: ".katex-display",
    mathLineSelector: ".base",
    hiddenMathSelector: ".katex-mathml",

    // --- Pages ---
    /** /a/chat/s/<uuid> */
    conversationId: function (url) {
      var m = /\/chat\/s\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(url || location.pathname);
      return m ? m[1] : null;
    },
    isChatPage: function (path) { return !!S.conversationId(path); },

    // --- After a reload (docs/DEEPSEEK.md §6–7) ---
    /** The answer's Markdown in a history message: `content`, or its RESPONSE fragments (never reasoning or search). */
    answerMarkdown: function (msg) {
      if (!msg) return "";
      var fromFragments = Array.isArray(msg.fragments) ? msg.fragments.filter(function (f) { return !f.type || /^response$/i.test(f.type); })
        .map(function (f) { return typeof f.content === "string" ? f.content : ""; }).join("") : "";
      return fromFragments || (typeof msg.content === "string" ? msg.content : "");
    },
    /** This conversation's messages, as the page loads them (same origin, the page's own login). Null on failure. */
    fetchHistory: function (conv) {
      var token = null;
      try { token = JSON.parse(localStorage.getItem("userToken") || "null"); token = token && (token.value || token); } catch (e) { token = null; }
      var headers = token && typeof token === "string" ? { Authorization: "Bearer " + token } : {};
      return fetch("/api/v0/chat/history_messages?chat_session_id=" + encodeURIComponent(conv), { credentials: "include", headers: headers })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { var d = j && j.data && j.data.biz_data; return d && Array.isArray(d.chat_messages) ? d.chat_messages : null; })
        .catch(function () { return null; });
    },
    /** Markdown → HTML in DeepSeek's answer classes (JR.renderMarkdown draws, this re-dresses it). */
    renderAnswer: function (md) {
      var box = document.createElement("div");
      box.innerHTML = JR.renderMarkdown(md || "");
      Object.keys(DS_CLASS).forEach(function (tag) {
        Array.prototype.forEach.call(box.getElementsByTagName(tag), function (el) { el.classList.add(DS_CLASS[tag]); });
      });
      return '<div class="ds-markdown ds-assistant-message-main-content">' + box.innerHTML + "</div>";
    },

    /** For JR.SEL.turn (closest/matches on any node). */
    turnSelectorAll: C.item,
  };
})();

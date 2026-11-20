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
  function cardsRoot(composer) { var b = S.composerBox(composer); return b && b.parentElement; } // the input card
  function isAnswer(item) {
    return !!(item && item.querySelector(C.answerBody + ", " + C.answerBodyFallback));
  }
  /** Inside DeepThink's reasoning block: never shown in popups (user, 2026-11-17). */
  function inThinking(el, item) {
    for (var e = el.parentElement; e && e !== item; e = e.parentElement) if (/think/i.test(e.className)) return true;
    return false;
  }

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
  var need = {}; // keepMounted: owner → the key it keeps drawn
  var S = JR.sites.deepseek = {
    name: "deepseek",
    label: "DeepSeek",
    hideDeclaration: JR_HOST.all.deepseek.decl,
    chatUrl: function (conv) { return "/a/chat/s/" + conv; },

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
    /** While Popup sends: CSS matching every item that arrives under a temporary (negative) key — the question item
     *  mounts before its answer and before the reply names their ids, so key-based hiding can't catch it yet.
     *  shortcut: an older temporary item (the user's own send this session) that mounts during a Popup send hides
     *  until the send ends; key the exception list on the snapshot if that ever shows. */
    freezeSelector: function () {
      var known = Array.prototype.slice.call(root().querySelectorAll(C.item)).map(function (i) { return i.getAttribute(KEY); })
        .filter(function (k) { return Number(k) < 0; });
      return C.item + "[" + KEY + '^="-"]' + known.map(function (k) { return ":not(" + itemSel(k) + ")"; }).join("");
    },
    /** CSS for the answer item with this key and the user item before it (also under its temporary key). */
    turnSelector: function (key) {
      if (!key) return null;
      var keys = [String(key)].concat(tempsOf[key] || []);
      return keys.map(JR_HOST.all.deepseek.hide).join(", ");
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
    // the body itself, not its children: the site styles answers under its class (as ChatGPT, R36f)
    assistantHTML: function (turn) { return S.assistantBodies(turn).map(function (b) { return b.outerHTML; }).join(""); },
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
    // Attachments (B5, live 2026-11-18): file cards `.ds-animated-size-item` sit in the input card above the box with
    // the send button; no file name text — the image's alt is the file's name; `.ds-icon` in the card removes it;
    // while uploading a `.ds-loading` ring shows (its overlay goes to opacity 0 when done)
    /** The cards' remove icons (chat.js matches them to files by buttonLabel). */
    attachBox: function (composer) { return cardsRoot(composer); },
    composerButtons: function (composer) {
      var r = cardsRoot(composer);
      return r ? Array.prototype.slice.call(r.querySelectorAll(".ds-animated-size-item .ds-icon")) : [];
    },
    buttonLabel: function (b) {
      var card = b.closest(".ds-animated-size-item"), img = card && card.querySelector("img[alt]");
      return "Remove " + (img ? img.getAttribute("alt") : card ? card.textContent : "").trim();
    },
    composerHasAttachments: function (composer) {
      var r = cardsRoot(composer);
      return !!(r && r.querySelector(".ds-animated-size-item"));
    },
    composerCardCount: function (composer) {
      var r = cardsRoot(composer);
      return r ? r.querySelectorAll(".ds-animated-size-item").length : 0;
    },
    attachmentsUploading: function (composer) {
      var r = cardsRoot(composer);
      return !!r && Array.prototype.some.call(r.querySelectorAll(".ds-animated-size-item .ds-loading"), function (l) {
        return l.checkVisibility({ opacityProperty: true });
      });
    },

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
      var m = JR_HOST.all.deepseek.conv.exec(url || location.pathname); // (the one rule: site-hosts.js)
      return m ? m[1] : null;
    },
    isChatPage: function (path) { return !!S.conversationId(path); },

    // --- After a reload (docs/DEEPSEEK.md §6–7) ---
    /** The answer's Markdown in a history message: `content`, or its RESPONSE fragments (never reasoning or search). */
    answerMarkdown: function (msg) {
      if (!msg) return "";
      var fromFragments = Array.isArray(msg.fragments) ? msg.fragments.filter(function (f) { return !f.type || /^response$/i.test(f.type); })
        .map(function (f) { return typeof f.content === "string" ? f.content : ""; }).join("") : "";
      var md = fromFragments || (typeof msg.content === "string" ? msg.content : "");
      // search sources: [citation:N] → a link "N" to the SEARCH fragment's result N (as deepseek-net.js does live)
      var url = {};
      (msg.fragments || []).forEach(function (f) { (f.results || []).forEach(function (r) { if (r && r.cite_index != null && r.url) url[r.cite_index] = r.url; }); });
      return md.replace(/\[citation:(\d+)\]/g, function (m, n) { return url[n] ? "[" + n + "](" + url[n] + ")" : ""; });
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
    /** An image preview's address from a history file's signed_path (DeepSeek's own builder, main.js 2026-11-18:
     *  https://<files host>/api<signed_path>&ty=p). shortcut: the default files host; DeepSeek can configure another
     *  (getFilesBaseDomain) — read it from the page if previews break. */
    filePreviewUrl: function (signedPath) {
      if (!signedPath) return null;
      var u = /^https?:\/\//.test(signedPath) ? signedPath : "https://files.deepseeksvc.com/api" + signedPath;
      return u + (u.indexOf("?") === -1 ? "?" : "&") + "ty=p";
    },
    /** For JR.SEL.turn (closest/matches on any node). */
    turnSelectorAll: C.item,
    /** A turn's place in the conversation: DeepSeek's message ids count up in conversation order. */
    turnPosition: function (key) { return /^\d+$/.test(key) ? Number(key) : -1; },

    /** Keep this hidden answer drawn in DeepSeek's list (0 px, unseen) so Popup can copy DeepSeek's own rendering
     *  (it can't be framed); null lets go. deepseek-net.js widens the list's window to reach it. */
    /** Keep the item with this key drawn (null: let it go). owner: "send" (chat.js, while it answers) or "popup" (the
     *  active popup's original) — each keeps its own (review: they took the one slot from each other). */
    keepMounted: function (key, owner) {
      need[owner || "send"] = key || null;
      var v = Object.keys(need).map(function (o) { return need[o]; }).filter(Boolean).join(" ");
      if (v) document.documentElement.setAttribute("data-jr-ds-need", v);
      else document.documentElement.removeAttribute("data-jr-ds-need");
    },

    /** Called every 500 ms (content.js): DeepSeek's question outline at the right edge lists every user message.
     *  Popup's are shown there as their question only ("· question", user, 2026-11-18: a small dot, not hidden — the outline places
     *  rows by index, hiding left gaps); a click opens that popup. Entries have build-hashed classes: found by text. */
    tidy: function () {
      Array.prototype.forEach.call(document.querySelectorAll(C.scroller + " .ds-virtual-list-visible-items"), function (box) {
        if (box.querySelector(C.item)) return; // the conversation itself (markOutline checks again: a new chat's list starts empty)
        if (!outlineSeen.has(box)) {
          outlineSeen.add(box);
          new MutationObserver(function () { markOutline(box); }).observe(box, { childList: true, subtree: true, characterData: true });
        }
        markOutline(box);
      });
    },
  };
  /**
   * The original of a hidden answer (site-answer.js, design A): DeepSeek can't be framed, but the answer is in its list —
   * kept drawn there (0 px, unseen; keepMounted) until JR.siteOriginalRelease(key). Null after ~5 s if the list doesn't
   * draw it (still kept) (an answer above the list's first drawn item can't be reached).
   */
  var kept = null;
  JR.siteOriginal = function (key) {
    S.keepMounted(kept = key, "popup");
    var n = 0;
    return new Promise(function (resolve) {
      (function poll() {
        if (kept !== key) return resolve(null); // released meanwhile
        var turn = S.findTurnByKey(key);
        if (turn && S.assistantText(turn).trim()) return resolve(turn);
        // (still kept: its popup asks again while it is active, and the release clears it — review: on / off every
        // 8 s made DeepSeek redraw its list again and again)
        if (++n > 25) return resolve(null);
        setTimeout(poll, 200);
      })();
    });
  };
  JR.siteOriginalRelease = function (key) {
    if (kept !== key) return;
    kept = null;
    S.keepMounted(null, "popup");
  };

  // DeepSeek's code blocks carry their theme in a class (md-code-block-light / -dark, B3); a copy keeps the one it was
  // copied with — the live one follows its original, the others (a parent under its child) stayed in the old theme
  // after a switch (docs/DEEPSEEK.md "not done"). On a switch, every copy's blocks take the theme of the page.
  S.syncCodeTheme = function () {
    var dark = !!(document.body && (document.body.classList.contains("dark") || document.body.getAttribute("data-ds-dark-theme") === "dark"));
    Array.prototype.forEach.call(document.querySelectorAll(".jr-popup-response .md-code-block-light, .jr-popup-response .md-code-block-dark"), function (b) {
      b.classList.toggle("md-code-block-dark", dark);
      b.classList.toggle("md-code-block-light", !dark);
    });
  };
  if (document.body) new MutationObserver(S.syncCodeTheme).observe(document.body, { attributes: true, attributeFilter: ["class", "data-ds-dark-theme"] });

  var outlineSeen = new WeakSet();
  function markOutline(box) {
    if (box.querySelector(C.item)) return;
    Array.prototype.forEach.call(box.children, function (row) {
      var text = row.firstElementChild || row, msg = text.textContent || "";
      var p = JR.isPopupMessage(msg) ? JR.parsePopupMessage(msg) : null;
      var gone = !!p && !!JR.popupMessageDeleted && JR.popupMessageDeleted(msg, p);
      var label = !p ? null : gone ? "\u00b7 deleted" : p.question ? "\u00b7 " + p.question.replace(/\s+/g, " ").trim() : null;
      if (row.classList.contains("jr-outline-popup") !== !!label) row.classList.toggle("jr-outline-popup", !!label);
      if (row.classList.contains("jr-outline-gone") !== gone) row.classList.toggle("jr-outline-gone", gone);
      if (label && text.getAttribute("data-jr-q") !== label) text.setAttribute("data-jr-q", label);
    });
  }
  // Hovering an outline entry shows DeepSeek's tooltip with the entry's full text: for a popup question, the question
  // only. Checked every frame while hovering (rAF runs before the frame is painted: the full text is never seen).
  var tipUntil = 0, tipRow = null;
  document.addEventListener("mouseover", function (e) {
    var row = e.target.closest && e.target.closest(".jr-outline-popup");
    if (!row) return;
    tipRow = row;
    var running = Date.now() < tipUntil;
    tipUntil = Date.now() + 3000;
    if (running) return;
    (function fix() {
      Array.prototype.forEach.call(document.querySelectorAll(".ds-tooltip"), function (tip) {
        var p = JR.isPopupMessage(tip.textContent || "") ? JR.parsePopupMessage(tip.textContent) : null;
        if (!p || !p.question) return;
        var shown = tipRow && tipRow.classList.contains("jr-outline-gone") ? "deleted" : p.question; // as its row says
        var w = document.createTreeWalker(tip, NodeFilter.SHOW_TEXT), n, first = true;
        while ((n = w.nextNode())) { n.nodeValue = first ? shown : ""; first = false; } // DeepSeek's own text nodes
      });
      if (Date.now() < tipUntil) requestAnimationFrame(fix);
    })();
  }, true);
  // A click on a popup question in the outline opens its popup (DeepSeek would scroll to the hidden message)
  document.addEventListener("click", function (e) {
    var row = e.target.closest && e.target.closest(".jr-outline-popup");
    if (!row || !JR.openPopupForMessage) return;
    e.preventDefault();
    e.stopPropagation();
    if (!row.classList.contains("jr-outline-gone")) JR.openPopupForMessage((row.firstElementChild || row).textContent || "");
  }, true);

})();

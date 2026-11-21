// claude.js — The ONLY place that knows claude.ai's DOM. Step 4 (after DeepSeek).
//
// Implements the same JR.site interface as site-adapter.js does for ChatGPT, so the rest of Popup runs
// unchanged. Wired in by the Step 4a refactor (docs/DEEPSEEK.md §8 + docs/CLAUDEAI.md §8): site-adapter.js
// picks JR.sites.claude when location.hostname is claude.ai.
//
// claude.ai's DOM (probed 2026-11-17, docs/CLAUDEAI.md):
// - scroller [data-autoscroll-container]; virtual list "rocksteady": [data-testid=transcript-sizer]
//   (full height) holds a top spacer, the mounted rows (normal flow, inline display:flow-root) and a
//   bottom spacer; only the rows near the screen are mounted (30-row chat: 7 mounted).
// - every message is its own row [data-testid=transcript-row] ([data-perf-row=human|assistant],
//   [data-index]): a human row then its assistant row.
// - human row: [data-cds=UserMessage][data-turn-key=K]; assistant row:
//   [data-cds=AssistantMessage][data-turn-key="K-hub-reply"][data-is-streaming]. K = the user message uuid.
// - Popup's "turn" is the ASSISTANT row, keyed by K (no -hub-reply); the human row is hidden with it.
// - Hiding: NOT display:none. rocksteady's ResizeObserver skips a row whose border box is 0×0 and keeps its
//   old/estimated height, so the spacers are too tall and scrolling past hidden Q&As shows blank space
//   (the 2026-10 P3 flash). A row with height 0 but its full width is measured as 0 and stored: no blank.
(function () {
  "use strict";

  var C = {
    scroller: "[data-autoscroll-container]",
    sizer: "[data-testid=transcript-sizer]",
    list: "[data-testid=transcript-list]",      // the transcript column: full height, holds the sizer
    row: "[data-testid=transcript-row]",
    user: "[data-cds=UserMessage]",
    answer: "[data-cds=AssistantMessage]",
    answerBody: "[data-cds=Prose]",              // the reply text (not [data-cds=TurnStatus], the "thinking / searched" line)
    composer: "[data-testid=chat-input], [data-testid=code-prompt-input]", // a chat; Claude Code on the web
    sendButton: "[data-testid=chat-input-send], [data-testid=code-prompt-send]", // (Claude Code's: only once text is in)
    stopButton: "[data-testid=chat-input-stop], [data-testid=code-prompt-stop]",
    composerCard: "[data-cds=ChatComposer]", // Claude Code's box (its send button isn't there while it is empty)
    attachButton: "[data-testid=chat-input-attach]",
    codeBlock: "pre",
    codeSource: "code",
  };
  var KEY = "data-turn-key", REPLY = "-hub-reply";

  function isVisible(el) {
    return !!(el && el.isConnected && el.checkVisibility && el.checkVisibility());
  }
  function first(sel, r) {
    var list = (r || document).querySelectorAll(sel);
    for (var i = 0; i < list.length; i++) if (isVisible(list[i])) return list[i];
    return null;
  }
  function scroller() { return first(C.scroller); }
  function root() { return scroller() || document; }
  /** Coloured = tokens in at least two colours (uncoloured code can carry one plain inline colour). */
  function codeColoured(pre) {
    var seen = {};
    Array.prototype.slice.call(pre.querySelectorAll('[style*="color"]'), 0, 60).forEach(function (s) { seen[s.style.color] = 1; });
    return Object.keys(seen).length >= 2;
  }
  function theme() { return document.documentElement.getAttribute("data-mode") === "dark" ? "dark" : "light"; }
  function cardsRoot(composer) { var b = S.composerBox(composer); return b && b.parentElement; } // also holds the file tiles
  function q(k) { return String(k).replace(/["\\]/g, ""); }
  function isAnswerRow(row) { return !!(row && row.querySelector(C.answer)); }
  /** A row's reply text with the blocks beside it that hold a card or media (Claude Code: a file it made, "HTML
   *  login.html 6.5 kB"; claude.ai: an artifact, "Red Button · Artifact" — its preview opens from it), not the status
   *  line ("Created login.html"); in page order. */
  function mediaBeside(row, prose) {
    var status = row.querySelector(C.answer + " [data-cds=TurnStatus]"), box = status && status.parentElement;
    if (!box) return prose;
    // (a card's block holds its title as reply text too: the whole block, and that text not twice — live T-e4)
    var media = Array.prototype.filter.call(box.children, function (c) {
      return c !== status && Array.prototype.some.call(c.querySelectorAll("button, img, video, audio, iframe, canvas, picture"),
        function (m) { return !m.closest(C.answerBody); });
    });
    if (!media.length) return prose;
    return prose.filter(function (p) { return !media.some(function (m) { return m.contains(p); }); }).concat(media)
      .sort(function (x, y) { return x.compareDocumentPosition(y) & 4 ? -1 : 1; });
  }
  // A chat's answer is keyed "<question key>-hub-reply"; Claude Code's by its own id, the key itself — and one that used a
  // tool spans rows with that same key: the tool step's row, then the reply's (live 2026-11-19)
  function rowsOf(r, attr) {
    return Array.prototype.slice.call(r.querySelectorAll(C.answer + "[" + KEY + '="' + q(attr) + '"]')).map(function (a) { return a.closest(C.row); });
  }
  /** The Q&A's answer row: its last one (the reply after any tool steps). */
  function answerRowOf(r, key) {
    var rows = rowsOf(r, key + REPLY);
    if (!rows.length) rows = rowsOf(r, key);
    return rows.length ? rows[rows.length - 1] : null;
  }

  function textWithBreaks(el) {
    var out = "";
    (function walk(node) {
      for (var c = node.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) out += c.nodeValue;
        else if (c.nodeType === 1) {
          if (c.tagName === "BR") { out += "\n"; continue; }
          if (c.tagName === "BUTTON" || c.tagName === "svg") continue;
          // a sent file's tile carries its name as text ("1794982711152_image.png"): not part of the question
          if (c.matches('[data-cds^="MessageAttachments"], [data-testid=file-thumbnail]')) continue;
          walk(c);
          if (c.tagName === "P") out += "\n\n"; // claude.ai draws each paragraph of a message as its own <p>: a blank line (Popup's message parts)
          else if (/^(DIV|LI)$/.test(c.tagName) && out && out[out.length - 1] !== "\n") out += "\n";
        }
      }
    })(el);
    return out.replace(/\n{3,}/g, "\n\n").trim();
  }

  JR.sites = JR.sites || {};
  var S = JR.sites.claude = {
    name: "claude",
    label: "Claude",

    /** CSS that hides a Q&A's rows (see the header: never display:none here). */
    hideDeclaration: JR_HOST.all.claude.decl,

    // --- Turns (= assistant rows) ---
    turns: function () { return Array.prototype.slice.call(root().querySelectorAll(C.row)).filter(isAnswerRow); },
    turnOf: function (node) {
      var el = node && (node.nodeType === 3 ? node.parentElement : node);
      var row = el && el.closest && el.closest(C.row);
      if (!row) return null;
      if (isAnswerRow(row)) return row;
      var next = row.nextElementSibling; // a node in the human row: its answer row
      return next && next.matches(C.row) && isAnswerRow(next) ? next : null;
    },
    /** K: the user message uuid (the assistant message's key without "-hub-reply"). */
    turnKey: function (turn) {
      var a = turn && turn.querySelector(C.answer);
      var k = a && a.getAttribute(KEY);
      return k ? k.replace(/-hub-reply$/, "") : null;
    },
    /** During a Popup send (chat.js freezeChat): a Popup message's question row comes before its answer row — the
     *  "turn" the freeze hides by key — and was seen until the answer arrived (user 2026-11-20, Claude Code: the
     *  message showed in the main chat, then went). Marked as it is added, before it is painted (styles.css). */
    freezeRow: function (node) {
      var rows = node.matches(C.row) ? [node] : Array.prototype.slice.call(node.querySelectorAll(C.row));
      var up = node.closest && node.closest(C.row);
      if (up && rows.indexOf(up) === -1) rows.push(up);
      rows.forEach(function (row) {
        var u = row.querySelector(C.user);
        if (u && !row.hasAttribute("data-jr-freeze") && JR.isPopupMessage(textWithBreaks(u))) row.setAttribute("data-jr-freeze", "");
      });
    },
    /** Both rows of the Q&A (rocksteady keeps them as siblings, each with its own key) — the hiding rule's. */
    turnSelector: function (key) { return key ? JR_HOST.all.claude.hide(key) : null; },
    findTurnByKey: function (key) { return key ? answerRowOf(root(), key) : null; },
    /** The conversation, from the data claude.ai's page loads: its turn keys in order (current branch; rocksteady mounts
     *  only rows near the view, so the rows alone can't order or reach the others) and each turn's question and answer
     *  as text (Markdown), for answers not on the page: { order: [key], turns: { key: { question, answer } } }. */
    fetchConversation: function (conv) {
      var org = (document.cookie.match(/(?:^|; )lastActiveOrg=([^;]+)/) || [])[1];
      // shortcut: a Claude Code session has no chat_conversations data (its own source not found yet) — its answers
      // come from the page (or the render frame) only; upgrade once its data source is known
      if (!org || !conv || /^session_/.test(conv)) return Promise.resolve(null);
      return fetch("/api/organizations/" + org + "/chat_conversations/" + conv + "?tree=True&rendering_mode=messages", { credentials: "include" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!j || !j.chat_messages) return null;
          var by = {}, kids = {}, onBranch = {}, order = [], turns = {};
          // a step the page can't show (web search…) comes as this text: not part of the answer (live 2026-11-18)
          var NA = /^\s*```\s*This block is not supported on your current device yet\.\s*```\s*$/;
          function text(m) {
            return (m.content || []).filter(function (c) { return c.type === "text" && !NA.test(c.text); }).map(function (c) { return c.text; }).join("\n\n") || m.text || "";
          }
          j.chat_messages.forEach(function (m) { by[m.uuid] = m; (kids[m.parent_message_uuid] = kids[m.parent_message_uuid] || []).push(m); });
          for (var m = by[j.current_leaf_message_uuid], g = 0; m && g < 100000; g++, m = by[m.parent_message_uuid]) {
            onBranch[m.uuid] = true;
            if (m.sender === "human") order.push(m.uuid);
          }
          j.chat_messages.forEach(function (h) {
            if (h.sender !== "human") return;
            var as = (kids[h.uuid] || []).filter(function (a) { return a.sender === "assistant"; });
            var a = as.filter(function (x) { return onBranch[x.uuid]; })[0] || as[as.length - 1]; // the answer shown, else the latest
            if (a) turns[h.uuid] = { question: text(h), answer: text(a) };
          });
          return { order: order.reverse(), turns: turns };
        });
    },

    // Hidden same-origin render frame (src/site-render.js): claude.ai allows it (frame-ancestors 'self')
    frameScroller: function (doc) { return doc.querySelector(C.scroller); },
    frameTurn: function (doc, key) { return key ? answerRowOf(doc, key) : null; },
    frameTurnCount: function (doc) { return doc.querySelectorAll(C.row).length; },

    // --- Roles & bodies ---
    assistantUnitOf: function (node) {
      var el = node && (node.nodeType === 3 ? node.parentElement : node);
      return (el && el.closest && el.closest(C.answer)) || null;
    },
    hasAssistant: function (turn) { return isAnswerRow(turn); },
    /** The reply text of the answer, in all its rows (Claude Code: around its tool steps) — and the cards beside it
     *  (a file or an artifact it made, its preview opens from there: user 11-20 "能显示图片和多媒体"), in page order. */
    assistantBodies: function (turn) {
      var a = turn && turn.querySelector(C.answer), k = a && a.getAttribute(KEY);
      var rows = k && turn.parentElement ? rowsOf(turn.parentElement, k) : [turn];
      return rows.filter(Boolean).reduce(function (all, r) {
        var prose = Array.prototype.slice.call(r.querySelectorAll(C.answer + " " + C.answerBody));
        return all.concat(mediaBeside(r, prose));
      }, []);
    },
    hasUndrawnWidget: function () { return false; },
    renderFailed: function () { return false; },
    // the body itself, not its children: the site styles answers under its class (as ChatGPT, R36f)
    assistantHTML: function (turn) {
      return S.assistantBodies(turn).map(function (b) { return b.outerHTML.replace(/^<(\w+)/, '<$1 data-jr-theme="' + theme() + '"'); }).join("");
    },
    /** A mounted answer is worth copying only once its code is coloured (claude.ai colours code on screen only:
     *  a hidden row never is; site-render.js draws it where it is). */
    harvestable: function (turn) {
      return Array.prototype.every.call(turn.querySelectorAll(C.answerBody + " pre"), codeColoured);
    },
    codeColoured: codeColoured,
    /** Mark a copy with the theme it was drawn in: claude.ai colours code tokens with inline styles of that theme
     *  (styles.css turns a copy's code around when the theme changes afterwards). */
    markCopy: function (el) { if (el.getAttribute("data-jr-theme") !== theme()) el.setAttribute("data-jr-theme", theme()); },
    assistantText: function (turn) { return S.assistantBodies(turn).map(function (b) { return b.textContent || ""; }).join("\n"); },
    /** The question: the human row right before the answer row (null if the window unmounted it). */
    userText: function (turn) {
      var row = turn && turn.previousElementSibling, k = S.turnKey(turn);
      while (row && row.matches && row.matches(C.row) && isAnswerRow(row) && S.turnKey(row) === k) row = row.previousElementSibling; // (its tool steps)
      var u = row && row.matches && row.matches(C.row) ? row.querySelector(C.user) : null;
      return u ? textWithBreaks(u) : null;
    },

    /** Files a sent question carried, from its (hidden) row while mounted: { name, mime, url } (after a reload). */
    sentAttachments: function (key) {
      var u = key && document.querySelector(C.user + "[" + KEY + '="' + q(key) + '"]');
      if (!u) return [];
      return Array.prototype.map.call(u.querySelectorAll('[data-cds^="MessageAttachments"][data-testid=file-thumbnail]'), function (t) {
        var img = t.querySelector("img"), name = (t.textContent || "").trim().replace(/^\d{10,}_/, "") || "file";
        return { id: null, name: name, mime: img ? "image/" : "", url: img ? img.src : null };
      });
    },

    // --- Composer (tiptap ProseMirror, like ChatGPT's) ---
    composer: function () { return first(C.composer); },
    composerText: function (composer) { return composer ? composer.textContent || "" : ""; },
    /** The box around the editor that also holds the send button (no <form>). */
    composerBox: function (composer) {
      for (var el = composer && composer.parentElement, n = 0; el && n < 10; el = el.parentElement, n++) {
        if (el.querySelector(C.sendButton + ", " + C.stopButton)) return el;
      }
      return (composer && composer.closest(C.composerCard)) || (composer ? composer.parentElement : null);
    },
    sendButton: function (composer) {
      var box = S.composerBox(composer);
      var b = box && box.querySelector(C.sendButton);
      return b && !b.disabled && isVisible(b) ? b : null;
    },
    stopButton: function () { return first(C.stopButton); },
    isStopButton: function (node) { return !!(node && node.closest && node.closest(C.stopButton)); },
    /** Claude answers: a reply marked streaming, or the stop button is up. */
    isGenerating: function () {
      return !!(document.querySelector(C.answer + '[data-is-streaming="true"]') || S.stopButton());
    },
    // Attachments (C6, live 2026-11-18): file tiles `[data-cds-attachment]` sit one level above the box with the send
    // button; each has `button[data-cds-attachment-remove]` labelled "Remove <name>", a pasted image's name prefixed
    // with a timestamp ("1794982515243_image.png")
    attachBox: function (composer) { return cardsRoot(composer); },
    composerButtons: function (composer) {
      var r = cardsRoot(composer);
      return r ? Array.prototype.slice.call(r.querySelectorAll("button[aria-label]")) : [];
    },
    buttonLabel: function (b) { return (b.getAttribute("aria-label") || "").replace(/^(Remove )\d{10,}_/, "$1"); },
    composerHasAttachments: function (composer) {
      var r = cardsRoot(composer);
      return !!(r && r.querySelector("[data-cds-attachment]"));
    },
    composerCardCount: function (composer) {
      var r = cardsRoot(composer);
      return r ? r.querySelectorAll("[data-cds-attachment]").length : 0;
    },
    attachmentsUploading: function (composer) {
      var r = cardsRoot(composer);
      return !!(r && r.querySelector("[data-cds-attachment] [role=progressbar], [data-cds-attachment][aria-busy=true], [data-cds-attachment] [aria-busy=true]"));
    },

    // --- Layout ---
    scrollContainer: function () { return scroller() || document.scrollingElement; },
    /** Before Popup scrolls the chat: at the bottom, claude.ai keeps it pinned there (any later change in the list
     *  brings it back down, live 2026-11-18) and lets go only when the user scrolls up — a wheel event (tested live). */
    unpin: function () {
      var s = scroller();
      if (!s) return;
      var w = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
      w._jrPressed = true; // (Popup's own: not the user scrolling — chat.js markUser)
      s.dispatchEvent(w);
    },
    /** Level-1 popups live in the transcript column: full height, not one of rocksteady's rows. */
    popupHost: function (turn) {
      var host = (turn && turn.closest && turn.closest(C.list)) || first(C.list, root()) || root().querySelector(C.sizer);
      return host || scroller() || document.body;
    },
    chatColumn: function () { return scroller(); },
    /** Claude Code on the web keeps a panel on the right for good (environment, context): Popup's ∧ ∨ go inside the chat's
     *  right edge there, not hidden as for a sidebar that was opened (live round 4, B17: no arrows on Claude Code at all).
     *  Px from the window's right edge; null elsewhere. */
    /** Claude Code: a Popup question asks the agent to answer in text only (qa-content.js buildMessage). */
    answerOnly: function () { return /^\/code\//.test(location.pathname); },
    navRight: function () {
      if (!/^\/code\//.test(location.pathname)) return null;
      var sc = scroller();
      // -1: not laid out yet (the page's skeleton, no rows: the arrows went to the right panel, then jumped — live round 5)
      if (!sc || !sc.querySelector(C.row)) return -1;
      return Math.max(0, Math.round(window.innerWidth - sc.getBoundingClientRect().right)) + 24;
    },
    /** On screen: from the scroller's top (below the chat header laid over it) to the composer box's top. */
    visibleBand: function () {
      var sc = scroller(), box = S.composerBox(S.composer()), head = document.querySelector("[data-testid=chat-header]");
      var top = Math.max(sc ? sc.getBoundingClientRect().top : 0, head ? head.getBoundingClientRect().bottom : 0);
      var bottom = box ? box.getBoundingClientRect().top - 8 : window.innerHeight;
      return { top: top, bottom: Math.min(bottom, window.innerHeight) };
    },

    // --- Rich content (code / math unconfirmed: browser request C1) ---
    codeBlockSelector: C.codeBlock,
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
    mathSelector: ".katex",
    mathTexSelector: 'annotation[encoding="application/x-tex"]',
    mathVisibleSelector: ".katex-html",
    mathDisplaySelector: ".katex-display",
    mathLineSelector: ".base",
    hiddenMathSelector: ".katex-mathml",

    // --- Pages ---
    /** /chat/<uuid>, or a Claude Code session on the web: /code/session_<id> (site-hosts.js) */
    conversationId: function (url) {
      var m = JR_HOST.all.claude.conv.exec(url || location.pathname);
      return m ? m[1] : null;
    },
    isChatPage: function (path) { return !!S.conversationId(path); },
    /** The conversation's page (the render frame loads it; ChatGPT's is "/c/<id>"). */
    chatUrl: function (conv) { return (/^session_/.test(conv) ? "/code/" : "/chat/") + conv; },

    /** For JR.SEL.turn (closest/matches on any node). */
    turnSelectorAll: C.row,
  };
})();

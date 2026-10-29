// site-adapter.js — The ONLY place that knows ChatGPT's DOM.
//
// Every "hook" Popup needs (turns, roles, response body, composer, send/stop,
// scroll container) is a list of candidate selectors, newest ChatGPT DOM first,
// older ones as fallbacks. The first candidate that matches wins and is recorded
// so JR.diagnose() can report exactly which selector each hook is using.
// When ChatGPT redesigns again, this file is normally the only one to change.
(function () {
  "use strict";

  // --- Candidate selectors (newest first) ---
  var C = {
    // One conversation turn. New DOM (2026-10): one [data-turn-key] holds a
    // user message AND its assistant answer. Legacy DOM: one article per message.
    turn: [
      "[data-turn-key]",
      '[data-testid^="conversation-turn-"]',
    ],
    // A message unit inside a turn, by role.
    assistantUnit: [
      '[data-content-search-unit-key$=":assistant"]',
      '[data-message-author-role="assistant"]',
      '[data-turn="assistant"]',
    ],
    userUnit: [
      '[data-content-search-unit-key$=":user"]',
      '[data-message-author-role="user"]',
      '[data-turn="user"]',
    ],
    // Rendered markdown of an assistant message (what Popup highlights in and copies into popups).
    assistantBody: [
      '[data-markdown-text-style="assistant-message"]',
      "[data-dil-message-id]",   // answers rendered by ChatGPT's DilRenderer (no markdown root)
      ".markdown",
    ],
    // Text of a user message.
    userBody: [
      '[data-user-message-bubble] [data-search-result-target]',
      "[data-user-message-bubble]",
      '[data-message-author-role="user"] .whitespace-pre-wrap',
    ],
    // ChatGPT's input box. The new DOM keeps hidden copies of the composer
    // (SPA page cache), so only a visible match counts.
    composer: [
      ".ProseMirror[data-composer-markdown]",
      "#prompt-textarea",
      'form [contenteditable="true"]',
      'textarea[name="prompt"]',
    ],
    sendButton: [
      'button[data-testid="send-button"]',
      "#composer-submit-button",
      'button[aria-label="Send"]',
      'button[aria-label="Send prompt"]',
      "button[data-composer-submit]",
      'button[type="submit"]',
    ],
    stopButton: [
      'button[data-testid="stop-button"]',
      "button[data-stop-generating]",
      'button[aria-label="Stop streaming"]',
      'button[aria-label="Stop generating"]',
      'button[aria-label="Stop"]',
    ],
    scrollContainer: [
      "[data-app-action-timeline-scroll]",
      '[class*="react-scroll-to-bottom"]',
    ],
    // Element that wraps the whole conversation list (popup host lives directly under it).
    conversation: [
      '[data-thread-find-target="conversation"]',
      "[data-chatgpt-conversation-selection-target]",
    ],
    // Rich content inside answers (T4).
    codeBlock: ["[data-code-block]", "pre"],
    codeSource: [".cm-content", "[data-code-block-source]", "code"], // .cm-content: CodeMirror (2026-10)
    codeControls: ["[data-code-block-controls]"],
    imagePreview: ['button[data-testid="generated-image-preview"]'],
    // Turn lifecycle attribute (value "complete" when done). Used as a secondary
    // "is generating" signal; values seen are recorded for diagnostics.
    turnState: ["[data-talvt-turn-state]"],
    // ChatGPT failed to render an answer ("This response couldn't load", T5).
    renderFailed: ["[data-dil-render-failed]"],
  };

  var used = {};      // hook → selector that matched last time
  var broken = {};    // hook → true when JR.diagnose({break}) simulates a failure
  var turnStatesSeen = {};

  function first(hook, root) {
    if (broken[hook]) return null;
    var list = C[hook];
    for (var i = 0; i < list.length; i++) {
      var el = (root || document).querySelector(list[i]);
      if (el) { used[hook] = list[i]; return el; }
    }
    return null;
  }

  function all(hook, root) {
    if (broken[hook]) return [];
    var list = C[hook];
    for (var i = 0; i < list.length; i++) {
      var els = (root || document).querySelectorAll(list[i]);
      if (els.length) { used[hook] = list[i]; return Array.prototype.slice.call(els); }
    }
    return [];
  }

  function closest(hook, node) {
    if (broken[hook] || !node) return null;
    var el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!el || !el.closest) return null;
    var list = C[hook];
    for (var i = 0; i < list.length; i++) {
      var hit = el.closest(list[i]);
      if (hit) { used[hook] = list[i]; return hit; }
    }
    return null;
  }

  /** Visible matches of the first candidate selector that has any (hidden SPA copies don't count). */
  function allVisible(hook, root) {
    if (broken[hook]) return [];
    var list = C[hook];
    for (var i = 0; i < list.length; i++) {
      var els = root.querySelectorAll(list[i]);
      var visible = [];
      for (var j = 0; j < els.length; j++) if (isVisible(els[j])) visible.push(els[j]);
      if (visible.length) { used[hook] = list[i]; return visible; }
    }
    return [];
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.closest("[hidden], [inert], [aria-hidden='true']")) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  var BLOCK_RE = /^(P|DIV|LI|UL|OL|PRE|BLOCKQUOTE|H[1-6]|TR)$/;

  /**
   * textContent with line breaks for <br> and block boundaries. innerText would
   * do this, but returns flat text for display:none elements (hidden Q&A turns).
   */
  function textWithBreaks(root) {
    var out = "";
    (function walk(node) {
      for (var c = node.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === Node.TEXT_NODE) {
          out += c.nodeValue;
        } else if (c.nodeType === Node.ELEMENT_NODE) {
          if (c.tagName === "BR") { out += "\n"; continue; }
          if (c.tagName === "BUTTON" || c.tagName === "svg") continue; // "Show more" toggles, icons
          var block = BLOCK_RE.test(c.tagName);
          if (block && out && out[out.length - 1] !== "\n") out += "\n";
          walk(c);
          if (block && c.tagName === "P") out += "\n\n"; // a paragraph break is a blank line
        }
      }
    })(root);
    return out.replace(/\n{3,}/g, "\n\n");
  }

  // ChatGPT keeps hidden copies of previously visited pages (SPA cache), each with
  // its own scroll container and turns. Everything is scoped to the visible one.
  var cachedScroller = null;
  function visibleScroller() {
    if (broken.scrollContainer) return null;
    if (cachedScroller && cachedScroller.isConnected && cachedScroller.offsetParent !== null) return cachedScroller;
    cachedScroller = null;
    var list = C.scrollContainer;
    for (var i = 0; i < list.length; i++) {
      var els = document.querySelectorAll(list[i]);
      for (var j = 0; j < els.length; j++) {
        if (els[j].offsetParent !== null) { used.scrollContainer = list[i]; cachedScroller = els[j]; return els[j]; }
      }
    }
    return null;
  }

  function activeRoot() {
    return visibleScroller() || document;
  }

  // Combined selector strings for code that needs closest()/matches() on any DOM generation.
  JR.SEL = {
    turn: C.turn.join(", "),
  };

  JR.site = {

    // --- Turns ---
    /** Turns of the conversation on screen (ChatGPT keeps hidden copies of other pages in the DOM). */
    turns: function () { return all("turn", activeRoot()); },
    turnOf: function (node) { return closest("turn", node); },

    /** Stable id of a turn. New DOM: the data-turn-key UUID. Legacy: "legacy-N". */
    turnKey: function (turn) {
      if (!turn) return null;
      var k = turn.getAttribute("data-turn-key");
      if (k) return k;
      var m = (turn.getAttribute("data-testid") || "").match(/conversation-turn-(\d+)/);
      return m ? "legacy-" + m[1] : null;
    },

    /** CSS selector matching the turn with this key (for hide rules). */
    turnSelector: function (key) {
      if (!key) return null;
      var m = /^legacy-(\d+)$/.exec(key);
      if (m) return '[data-testid="conversation-turn-' + m[1] + '"]';
      return '[data-turn-key="' + key.replace(/["\\]/g, "") + '"]';
    },

    findTurnByKey: function (key) {
      var sel = JR.site.turnSelector(key);
      return sel ? activeRoot().querySelector(sel) : null;
    },

    // --- Roles & bodies ---
    /** Assistant message unit containing node, or null (user text, page chrome, popups). */
    assistantUnitOf: function (node) { return closest("assistantUnit", node); },

    hasAssistant: function (turn) {
      if (!turn) return false;
      var list = C.assistantUnit;
      if (list.some(function (s) { return turn.matches(s); })) return true;
      return !!first("assistantUnit", turn);
    },

    /** Rendered markdown roots of the assistant answer(s) in a turn. */
    assistantBodies: function (turn) {
      if (!turn) return [];
      var units = all("assistantUnit", turn);
      if (units.length === 0 && JR.site.hasAssistant(turn)) units = [turn];
      var bodies = [];
      for (var i = 0; i < units.length; i++) {
        bodies = bodies.concat(all("assistantBody", units[i]));
      }
      if (bodies.length === 0 && units.length === 0) bodies = all("assistantBody", turn);
      return bodies;
    },

    /** True if ChatGPT shows "This response couldn't load" instead of the answer. */
    renderFailed: function (turn) {
      return !!(turn && first("renderFailed", turn));
    },

    /** Combined HTML of a turn's assistant answer(s). */
    assistantHTML: function (turn) {
      return JR.site.assistantBodies(turn).map(function (b) { return b.innerHTML; }).join("");
    },

    assistantText: function (turn) {
      return JR.site.assistantBodies(turn).map(function (b) { return b.textContent || ""; }).join("\n");
    },

    /** Plain text of the user message in a turn (newlines preserved). */
    userText: function (turn) {
      if (!turn) return null;
      var unit = first("userUnit", turn) || turn;
      var body = first("userBody", unit);
      return body ? textWithBreaks(body) : null;
    },

    // --- Composer ---
    composer: function () {
      var visible = allVisible("composer", document);
      for (var f = 0; f < visible.length; f++) if (visible[f].contains(document.activeElement)) return visible[f];
      return visible.length ? visible[visible.length - 1] : null;
    },

    composerText: function (composer) {
      if (!composer) return "";
      return composer.value != null && composer.tagName === "TEXTAREA" ? composer.value : (composer.textContent || "");
    },

    sendButton: function (composer) {
      var form = composer ? composer.closest("form") : null;
      return allVisible("sendButton", form || document)[0] || null;
    },

    stopButton: function () {
      return allVisible("stopButton", document)[0] || null;
    },

    // --- Composer attachments (Step 2) ---
    // A paste event with files on the composer makes ChatGPT add an attachment card
    // and upload it (synthetic file inputs and drops are ignored; PLAN-next.md IMG0).

    /** The composer's box: its text, attachment cards and buttons. */
    composerBox: function (composer) {
      return composer ? (composer.closest("form") || composer.parentElement) : null;
    },

    /**
     * The labelled buttons of the composer box. An attachment card has one whose
     * aria-label holds the file name as ChatGPT shows it ("Remove clipboard(3).png";
     * a file card also has one with just the name). T7: ChatGPT renames a file whose
     * name is taken by adding "(n)" before the extension.
     */
    composerButtons: function (composer) {
      var box = JR.site.composerBox(composer);
      return box ? Array.prototype.slice.call(box.querySelectorAll("button[aria-label]")) : [];
    },

    /**
     * True when the composer holds attachment cards (the user's own, before Popup
     * pastes anything): each card has one × whose icon is codex-icon-xmark (T7,
     * collab/evidence/s2/t7/composer-pdf.html); no other composer button uses it.
     */
    composerHasAttachments: function (composer) {
      var box = JR.site.composerBox(composer);
      return !!(box && box.querySelector('button use[href*="xmark"]'));
    },

    /** True while some card in the composer is still uploading. */
    attachmentsUploading: function (composer) {
      var box = JR.site.composerBox(composer);
      return !!(box && box.querySelector('[role="progressbar"], [aria-busy="true"]'));
    },

    isStopButton: function (node) { return !!closest("stopButton", node); },

    /** True while ChatGPT is generating: visible stop button, or a turn whose state isn't "complete". */
    isGenerating: function () {
      if (JR.site.stopButton()) return true;
      var states = activeRoot().querySelectorAll(C.turnState[0]); // not hidden cached pages
      for (var i = 0; i < states.length; i++) {
        var v = states[i].getAttribute("data-talvt-turn-state");
        turnStatesSeen[v] = true;
        if (/stream|progress|pending|generat|running/i.test(v)) return true;
      }
      return false;
    },

    // --- Layout ---
    scrollContainer: function () {
      var el = visibleScroller();
      if (el) return el;
      var t = first("turn");
      return t ? JR.getScrollParent(t) : document.querySelector("main");
    },

    /**
     * Stable element to host level-1 popups. Must NOT be a virtualized turn
     * slot (removed when scrolled off-screen, fixed height). New DOM (T4):
     * turn → slot(height) → list → div.relative(height = whole thread) →
     * [data-thread-find-target=conversation]; the full-height list child of
     * the conversation element is the host.
     */
    popupHost: function (turn) {
      var el = turn || JR.site.turns()[0];
      var conv = el && el.closest(C.conversation.join(", "));
      if (conv) {
        for (var c = conv.firstElementChild; c; c = c.nextElementSibling) {
          if (c.contains(el)) { used.popupHost = "conversation child"; return c; }
        }
      }
      var scroller = JR.site.scrollContainer();
      if (scroller && el && scroller.contains(el)) {
        while (el.parentElement && el.parentElement !== scroller) el = el.parentElement;
        if (el.parentElement === scroller) { used.popupHost = "scroll container child"; return el; }
      }
      used.popupHost = "fallback";
      if (turn && turn.parentElement) return turn.parentElement;
      return scroller || document.body;
    },

    /** The visible chat column (there are several <main> in the DOM; hidden SPA copies). */
    chatColumn: function () {
      var scroller = JR.site.scrollContainer();
      if (scroller && isVisible(scroller)) return scroller;
      var mains = document.querySelectorAll("main");
      for (var i = 0; i < mains.length; i++) if (isVisible(mains[i])) return mains[i];
      return null;
    },

    /**
     * New-DOM code blocks inside root (no <pre>; T4):
     * [data-code-block] > [data-code-block-source] > code, controls in [data-code-block-controls].
     * Returns [{ block, code, lang }]. Legacy <pre> blocks are handled by the caller.
     */
    codeBlocks: function (root) {
      var out = [];
      var blocks = root.querySelectorAll(C.codeBlock[0]);
      for (var i = 0; i < blocks.length; i++) {
        var src = blocks[i].querySelector(JR.site.codeSourceSelector) || blocks[i];
        var code = src.querySelector("code") || src;
        var lang = src.getAttribute("data-language") || "";
        if (lang) lang = lang.charAt(0).toUpperCase() + lang.slice(1);
        var m = (code.className || "").match(/language-([\w+#-]+)/);
        if (m) lang = m[1].charAt(0).toUpperCase() + m[1].slice(1);
        if (!lang) {
          // Language label: short text in the block outside the source and controls.
          var walker = document.createTreeWalker(blocks[i], NodeFilter.SHOW_TEXT, null);
          var n;
          while ((n = walker.nextNode())) {
            if (src.contains(n) || (n.parentElement && n.parentElement.closest(C.codeControls[0]))) continue;
            var t = n.nodeValue.trim();
            if (t && t.length < 30) { lang = t; break; }
          }
        }
        out.push({ block: blocks[i], code: code, lang: lang });
      }
      return out;
    },

    /** Entity links in answers: spans with React click handlers (not plain <a href>). */
    entitySelector: "span[data-inline-mention-interactive], span.cursor-pointer[class*='entity-underline'], span.cursor-pointer[class*='entity-accent']",

    /** Selector for code blocks (block-level unit for sentence extraction). */
    codeBlockSelector: C.codeBlock.join(", "),
    codeSourceSelector: C.codeSource.slice(0, 2).join(", "),

    /** CodeMirror's line elements in a code source element (one div.cm-line per line). */
    codeLineEls: function (src) { return src.querySelectorAll(".cm-line"); },

    /** Text of a code source element: CodeMirror keeps no "\n" between its lines. */
    codeText: function (src) {
      var lines = JR.site.codeLineEls(src);
      if (!lines.length) return src.textContent;
      return Array.prototype.map.call(lines, function (l) { return l.textContent; }).join("\n");
    },

    /** Citation chips, kept as one unit when extracting a sentence. */
    citationSelector: '[data-testid="webpage-citation-pill"], a[data-testid="chatgpt-citation"]',
    /**
     * Text a highlight span must not be put into: SVG charts (spans are not drawn)
     * and CodeMirror code (the editor removes them). Proxies go into the widget around it.
     */
    noWrapSelector: "svg, .cm-content, .recharts-wrapper",
    /** A chart's plot: axes, labels, legend, tooltip (Recharts). */
    chartPlotSelector: ".recharts-wrapper",
    noWrapHostSelector: "[data-client-defined-widget]",

    /** Text that is in the DOM but not on screen (a chart's screen-reader data table). */
    hiddenTextSelector: ".sr-only",

    /**
     * What a chart shows, from fixed places in its widget: the title and subtitle
     * above it (section[aria-labelledby] → title, then a subtitle <p>). Null outside charts.
     */
    chartContext: function (node) {
      var el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
      var widget = el && el.closest('[data-client-defined-widget="visualization"]');
      var section = widget && widget.querySelector("section[aria-labelledby]");
      if (!section) return null;
      var title = section.querySelector("#" + CSS.escape(section.getAttribute("aria-labelledby")));
      if (!title) return null;
      var sub = title.nextElementSibling;
      var t = title.textContent.trim(), s = sub && sub.tagName === "P" ? sub.textContent.trim() : "";
      return t ? (s ? t + " (" + s + ")" : t) : null;
    },

    /** Bold text: <strong>/<b>, and the 2026-10 answer renderer's bold spans. */
    strongSelector: "strong, b, [data-d-default-strong]",
    /**
     * The part of the thread the user actually sees, in viewport coordinates:
     * below the app header, above the bottom area (composer, plus the
     * "ChatGPT can make mistakes" line that sticks ~28px above it). Popups stay inside.
     */
    visibleBand: function () {
      function visible(sel) {
        return Array.prototype.filter.call(document.querySelectorAll(sel), isVisible)[0];
      }
      var h = visible("[data-app-shell-titlebar]");
      var f = visible("[data-thread-scroll-footer]");
      var top = h ? h.getBoundingClientRect().bottom : 0;
      var bottom = f ? f.getBoundingClientRect().top - 28 : window.innerHeight;
      return { top: top, bottom: Math.min(bottom, window.innerHeight) };
    },
    // KaTeX formulas: a visible copy plus an invisible one for screen readers
    // (MathML + the TeX source). Popup reads a formula as its TeX source, so the
    // question sent to ChatGPT is exact (10^8, not "108") and appears once.
    mathSelector: ".katex",
    mathTexSelector: 'annotation[encoding="application/x-tex"]',
    mathVisibleSelector: ".katex-html",
    mathDisplaySelector: ".katex-display",
    mathLineSelector: ".base", // one line of a formula (inline-block, real width)
    hiddenMathSelector: ".katex-mathml",

    /** Conversation id from the URL (/c/<id> or /g/<gpt>/c/<id>), or null on a new chat. */
    conversationId: function (url) {
      var m = /\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(url || location.pathname);
      return m ? m[1] : null;
    },

    /**
     * Popup works only in chats: a /c/<id> path (normal, GPT and project chats).
     * Off everywhere else: new-chat page, temporary chats (no id, nothing saved),
     * settings, GPTs, library, project home pages, shared links.
     */
    isChatPage: function (path) {
      return !!JR.site.conversationId(path);
    },
  };

  // --- Self-check ---

  function count(hook) {
    var els = all(hook);
    return { n: els.length, via: els.length ? used[hook] : null };
  }

  /**
   * Check every hook and report which selector each one uses.
   * opts.break = hook name (or array) → simulate that hook failing (for testing the warnings).
   * opts.unbreak = true → clear simulated failures.
   * The result is also written to #jr-diagnostics[data-json] so DOM-only tools can read it.
   */
  JR.diagnose = function (opts) {
    opts = opts || {};
    if (opts.unbreak) broken = {};
    if (opts.break) [].concat(opts.break).forEach(function (h) { broken[h] = true; });

    var turns = JR.site.turns();
    var assistantTurns = turns.filter(JR.site.hasAssistant);
    var bodies = 0;
    assistantTurns.forEach(function (t) { bodies += JR.site.assistantBodies(t).length; });
    var composer = JR.site.composer();
    var send = JR.site.sendButton(composer);
    var inConversation = !!JR.site.conversationId();

    var report = {
      version: (function () {
        try { var m = chrome.runtime.getManifest(); return m.version_name || m.version; }
        catch (e) { return "stale (extension was updated; reload the page)"; }
      })(),
      when: new Date().toISOString(),
      url: location.pathname,
      scrollTop: (function () { var sc = JR.site.scrollContainer(); return sc ? Math.round(sc.scrollTop) : null; })(),
      conversationId: JR.site.conversationId(),
      hooks: {
        turn: { n: turns.length, via: turns.length ? used.turn : null },
        assistantTurn: { n: assistantTurns.length, via: assistantTurns.length ? used.assistantUnit : null },
        assistantBody: { n: bodies, via: bodies ? used.assistantBody : null },
        composer: { n: composer ? 1 : 0, via: composer ? used.composer : null },
        sendButton: { n: send ? 1 : 0, via: send ? used.sendButton : null, note: send ? null : "only present while the composer has text" },
        stopButton: { n: JR.site.stopButton() ? 1 : 0, via: used.stopButton || null },
        scrollContainer: { n: visibleScroller() ? 1 : 0, via: visibleScroller() ? used.scrollContainer : null, inDom: all("scrollContainer").length },
      },
      generating: JR.site.isGenerating(),
      // ChatGPT's own "This response couldn't load" — not a Popup fault, but its content can't be used.
      renderFailedTurns: turns.filter(JR.site.renderFailed).length,
      turnStatesSeen: Object.keys(turnStatesSeen),
      simulatedBreaks: Object.keys(broken),
      state: {
        highlights: JR.state.completedHighlights.size,
        hiddenTurns: JR.state.hiddenTurnKeys ? JR.state.hiddenTurnKeys.size : 0,
        cachedQA: JR.qa ? JR.qa.cacheSize() : 0,
        conversationApi: JR.qa ? JR.qa.apiStatus : null,
        pendingRestore: JR.pendingRestoreCount ? JR.pendingRestoreCount() : 0,
      },
      perf: JR.perf ? JR.perf.snapshot() : null,
      lastSend: JR.state.lastSendReport || null,
    };

    var missing = [];
    if (!composer) missing.push("composer");
    if (inConversation && turns.length === 0) missing.push("turn");
    if (inConversation && turns.length > 0 && assistantTurns.length === 0) missing.push("assistantTurn");
    if (inConversation && assistantTurns.length > 0 && bodies === 0) missing.push("assistantBody");
    report.ok = missing.length === 0;
    report.missing = missing;

    writeDiagnostics(report);
    return report;
  };

  function writeDiagnostics(report) {
    var el = document.getElementById("jr-diagnostics");
    if (!el) {
      el = document.createElement("div");
      el.id = "jr-diagnostics";
      el.hidden = true;
      // Hidden button: DOM-only test tools click it to refresh the report.
      var btn = document.createElement("button");
      btn.id = "jr-diagnostics-run";
      btn.type = "button";
      btn.addEventListener("click", function () { JR.diagnose(); });
      el.appendChild(btn);
      document.body.appendChild(el); // inside <body>: never add nodes as siblings of ChatGPT's <head>/<body>
    }
    el.setAttribute("data-json", JSON.stringify(report));
    el.setAttribute("data-ok", report.ok ? "true" : "false");
    // Storage footprint (V2.1): this conversation's record and the whole store.
    try {
      var convKey = "popup:conv:" + (report.conversationId || "");
      chrome.storage.local.getBytesInUse(null, function (total) {
        chrome.storage.local.getBytesInUse(convKey, function (conv) {
          report.storageBytes = { conversation: conv, total: total };
          el.setAttribute("data-json", JSON.stringify(report));
        });
      });
    } catch (e) { /* extension context invalidated */ }
  }
})();

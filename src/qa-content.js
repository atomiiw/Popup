// qa-content.js — Popup Q&A turns: message format, hiding, and content lookup.
//
// Popup persists only KEYS (which turns are Popup Q&A, which text is highlighted).
// The content itself lives in ChatGPT's conversation; this module reads it back:
//   1. from a session-only memory cache, filled whenever a Q&A turn is in the DOM
//   2. from the turn in the DOM (ChatGPT virtualizes: only turns near the viewport exist)
// Nothing here is written to chrome.storage.
(function () {
  "use strict";

  var st = JR.state;

  // ---------------------------------------------------------------------------
  // Message format (single source of truth for every send path)
  // ---------------------------------------------------------------------------

  var LENGTH_SUFFIX = {
    concise: "\n\n(For this response only: please keep it brief — 2-3 sentences. After this response, return to your normal response length and disregard the above brevity instruction entirely.)",
    medium: "\n\n(For this response only: give a clear, focused response — medium length, not too short, not too long. Cover what matters without over-explaining. Use formatting only if it genuinely helps. After this response, return to your normal response length and disregard this length instruction entirely.)",
  };
  var PREFIX_PART = "Regarding this part of your response:\n";
  var PREFIX_WHOLE_BELOW = "Regarding your entire response below:\n\n";
  var PREFIX_WHOLE_ABOVE = "Regarding your entire response above:\n\n";
  var SUFFIX_MARK = "(For this response only:";

  /**
   * Build the message Popup injects into ChatGPT.
   * @param {object} o - { question, text, sentence, wholeResponse, wholeResponseFull, mode }
   */
  JR.buildMessage = function (o) {
    if (!o.question || !String(o.question).trim()) throw new Error("Popup: refusing to send an empty question");
    var message;
    if (o.wholeResponse) {
      message = o.wholeResponseFull
        ? PREFIX_WHOLE_BELOW + '"' + o.wholeResponseFull + '"\n\n' + o.question
        : PREFIX_WHOLE_ABOVE + o.question;
    } else if (o.sentence) {
      message = PREFIX_PART + '"' + o.sentence + '"\n\nSpecifically: "' + o.text + '"\n\n' + o.question;
    } else {
      message = PREFIX_PART + '"' + o.text + '"\n\n' + o.question;
    }
    return message + (LENGTH_SUFFIX[o.mode] || LENGTH_SUFFIX.medium);
  };

  /** True if a user message was written by Popup (works on old and new messages). */
  JR.isPopupMessage = function (msg) {
    if (!msg) return false;
    var s = msg.replace(/\r/g, "").trimStart();
    var hasPrefix = s.indexOf(PREFIX_PART.trim()) === 0 ||
      s.indexOf(PREFIX_WHOLE_BELOW.trim()) === 0 || s.indexOf(PREFIX_WHOLE_ABOVE.trim()) === 0;
    return hasPrefix && s.indexOf(SUFFIX_MARK) !== -1;
  };

  /**
   * Parse a Popup message back into its parts. Returns null if it isn't one.
   * @returns {{question:string, text:string|null, sentence:string|null, wholeResponse:boolean}|null}
   */
  JR.parsePopupMessage = function (msg) {
    if (!JR.isPopupMessage(msg)) return null;
    var s = msg.replace(/\r/g, "").trim();
    var cut = s.lastIndexOf(SUFFIX_MARK);
    var body = s.slice(0, cut).trim();
    var out = { question: "", text: null, sentence: null, wholeResponse: false };
    if (body.indexOf(PREFIX_WHOLE_ABOVE.trim()) === 0) {
      out.wholeResponse = true;
      out.question = body.slice(PREFIX_WHOLE_ABOVE.trim().length).trim();
      return out;
    }
    if (body.indexOf(PREFIX_WHOLE_BELOW.trim()) === 0) out.wholeResponse = true;
    // The question follows the last closing quote + blank line.
    var q = body.lastIndexOf('"\n\n');
    if (q === -1) { out.question = body; return out; }
    out.question = body.slice(q + 3).trim();
    var quoted = body.slice(0, q + 1);
    var spec = quoted.lastIndexOf('\n\nSpecifically: "');
    var firstQuote = quoted.indexOf('"');
    if (spec !== -1) {
      out.sentence = quoted.slice(firstQuote + 1, spec - 1);
      out.text = quoted.slice(spec + '\n\nSpecifically: "'.length, quoted.length - 1);
    } else if (!out.wholeResponse) {
      out.text = quoted.slice(firstQuote + 1, quoted.length - 1);
    }
    return out;
  };

  // ---------------------------------------------------------------------------
  // Hiding: one <style> with a display:none rule per hidden turn key.
  // CSS applies to a turn the instant React (re)mounts it, so virtualized
  // turns never flash and no observer has to re-add classes.
  // ---------------------------------------------------------------------------

  st.hiddenTurnKeys = new Set();
  var hideStyle = null;

  function renderHideStyle() {
    var rules = [];
    st.hiddenTurnKeys.forEach(function (k) {
      var sel = JR.site.turnSelector(k);
      if (sel) rules.push(sel);
      var slot = JR.site.turnSlotSelector(k);
      if (slot) rules.push(slot);
    });
    if (!hideStyle || !hideStyle.isConnected) {
      hideStyle = document.getElementById("jr-hide-turns") || document.createElement("style");
      hideStyle.id = "jr-hide-turns";
      (document.head || document.documentElement).appendChild(hideStyle);
    }
    hideStyle.textContent = rules.length ? rules.join(",\n") + " { display: none !important; }" : "";
  }

  JR.hideTurnKeys = function (keys) {
    var changed = false;
    (keys || []).forEach(function (k) {
      if (k && !st.hiddenTurnKeys.has(k)) { st.hiddenTurnKeys.add(k); changed = true; }
    });
    if (changed) renderHideStyle();
  };

  JR.unhideTurnKeys = function (keys) {
    var changed = false;
    (keys || []).forEach(function (k) {
      if (st.hiddenTurnKeys.delete(k)) changed = true;
    });
    if (changed) renderHideStyle();
  };

  JR.clearHiddenTurnKeys = function () {
    st.hiddenTurnKeys.clear();
    renderHideStyle();
  };

  // Tail flag: when the newest turn is a hidden Popup Q&A, ChatGPT's reserved
  // space after it (meant to scroll a new message to the top) would show as a
  // blank area. html.jr-tail-hidden hides that spacer (styles.css).
  JR.setTailHidden = function (on) {
    st.tailHidden = !!on;
    document.documentElement.classList.toggle("jr-tail-hidden", !!on);
  };

  /** Re-evaluate the tail flag from the turns at the bottom of the thread. */
  function updateTail(turns) {
    if (st.responseWatchActive || !turns.length) return;
    var sc = JR.site.scrollContainer();
    if (!sc || sc.scrollHeight - sc.scrollTop - sc.clientHeight > 2 * sc.clientHeight) return; // bottom not mounted
    JR.setTailHidden(st.hiddenTurnKeys.has(JR.site.turnKey(turns[turns.length - 1])));
  }

  // ---------------------------------------------------------------------------
  // Session content cache: turnKey → { question, text, sentence, responseHTML }
  // ---------------------------------------------------------------------------

  var cache = new Map();

  /** Read a mounted Q&A turn's content from the DOM. Returns null if it isn't usable yet. */
  function harvest(turn) {
    // ChatGPT's own render failure text is not the answer — never cache it.
    if (JR.site.renderFailed(turn)) return null;
    var userMsg = JR.site.userText(turn);
    var parsed = JR.parsePopupMessage(userMsg);
    var html = JR.site.assistantHTML(turn);
    var text = JR.site.assistantText(turn).trim();
    if (!parsed && !text) return null;
    return {
      question: parsed ? parsed.question : null,
      text: parsed ? parsed.text : null,
      sentence: parsed ? parsed.sentence : null,
      responseHTML: text ? html : null,
      isPopup: !!parsed,
    };
  }

  /** "__PENDING__" (answer in progress) and "__LOADING__" (answer not read back yet) render as a loading state. */
  JR.isPlaceholderHTML = function (h) {
    return h === "__PENDING__" || h === "__LOADING__";
  };

  JR.qa = {
    cacheSize: function () { return cache.size; },
    clear: function () { cache.clear(); },

    /** Content for a Q&A item (by its turn keys), or null if not available right now. */
    get: function (turnKeys) {
      for (var i = 0; i < (turnKeys || []).length; i++) {
        var k = turnKeys[i];
        var c = cache.get(k);
        if (c && c.responseHTML) return c;
        var turn = JR.site.findTurnByKey(k);
        if (turn) {
          var h = harvest(turn);
          if (h && h.responseHTML && !JR.site.isGenerating()) cache.set(k, h);
          if (h && h.responseHTML) return h;
        }
      }
      return null;
    },

    /** Store content captured at the end of streaming. */
    put: function (turnKey, content) {
      if (turnKey && content) cache.set(turnKey, content);
    },

    harvest: harvest,
  };

  // ---------------------------------------------------------------------------
  // Fallback: ChatGPT's own conversation data (the same JSON the page loads).
  // Used when a Q&A turn isn't in the DOM (virtualized away, or ChatGPT failed
  // to render it). A turn's data-turn-key is its user message id, so the answer
  // is that message's assistant reply. Fetched at most once per conversation
  // per page session; nothing is stored.
  // ---------------------------------------------------------------------------

  var convFetch = null;   // { id, promise }
  JR.qa.apiStatus = "unused";

  function fetchConversation() {
    var id = JR.site.conversationId();
    if (!id) return Promise.resolve(null);
    if (convFetch && convFetch.id === id) return convFetch.promise;
    JR.qa.apiStatus = "loading";
    var promise = fetch("/api/auth/session", { credentials: "include" })
      .then(function (r) { return r.json(); })
      .then(function (session) {
        if (!session || !session.accessToken) throw new Error("no session token");
        return fetch("/backend-api/conversation/" + id, {
          credentials: "include",
          headers: { Authorization: "Bearer " + session.accessToken },
        });
      })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (conv) {
        JR.qa.apiStatus = conv && conv.mapping ? "ok" : "no mapping";
        return conv && conv.mapping ? conv : null;
      })
      .catch(function (e) {
        JR.qa.apiStatus = "failed: " + (e && e.message);
        convFetch = null; // allow a retry later
        return null;
      });
    convFetch = { id: id, promise: promise };
    return promise;
  }

  function textOf(msg) {
    var parts = msg && msg.content && msg.content.parts;
    return parts ? parts.filter(function (p) { return typeof p === "string"; }).join("") : "";
  }

  /** The visible assistant answer following a user message node (current branch). */
  function answerFor(mapping, userId) {
    var node = mapping[userId];
    var answer = "";
    for (var guard = 0; node && node.children && node.children.length && guard < 50; guard++) {
      node = mapping[node.children[node.children.length - 1]];
      var m = node && node.message;
      if (!m || !m.author) continue;
      if (m.author.role === "user") break; // next turn
      var hidden = m.metadata && m.metadata.is_visually_hidden_from_conversation;
      var t = textOf(m);
      if (m.author.role === "assistant" && !hidden && t.trim()) answer = t;
    }
    return answer;
  }

  /**
   * Read these Q&A turns from the conversation data into the session cache,
   * then let open popups refresh. Resolves to the keys that were filled.
   */
  JR.qa.ensure = function (turnKeys) {
    var want = (turnKeys || []).filter(function (k) { return k && !cache.has(k); });
    if (!want.length) return Promise.resolve([]);
    return fetchConversation().then(function (conv) {
      if (!conv) return [];
      var filled = [];
      want.forEach(function (k) {
        var node = conv.mapping[k];
        if (!node || !node.message) return;
        var parsed = JR.parsePopupMessage(textOf(node.message));
        var answer = answerFor(conv.mapping, k);
        if (!answer) return;
        cache.set(k, {
          question: parsed ? parsed.question : null,
          text: parsed ? parsed.text : null,
          sentence: parsed ? parsed.sentence : null,
          responseHTML: JR.renderMarkdown(answer),
          isPopup: !!parsed,
        });
        filled.push(k);
      });
      if (filled.length && JR.onQAContentLoaded) JR.onQAContentLoaded(filled);
      return filled;
    });
  };

  /**
   * Every Popup-format question in the conversation data, as { turnKey, parsed }.
   * Lets old or unlinked items be matched to their Q&A without scrolling to it.
   */
  JR.qa.popupTurnsFromApi = function () {
    return fetchConversation().then(function (conv) {
      if (!conv) return [];
      var out = [];
      Object.keys(conv.mapping).forEach(function (id) {
        var m = conv.mapping[id].message;
        if (!m || !m.author || m.author.role !== "user") return;
        var parsed = JR.parsePopupMessage(textOf(m));
        if (parsed) out.push({ turnKey: id, parsed: parsed, created: m.create_time || 0 });
      });
      out.sort(function (a, b) { return a.created - b.created; });
      return out;
    });
  };

  JR.qa.resetApi = function () { convFetch = null; JR.qa.apiStatus = "unused"; };

  // ---------------------------------------------------------------------------
  // Turn mount observer: ChatGPT adds/removes turns as the user scrolls.
  // When a turn mounts we (a) cache hidden Q&A content, (b) hide Popup Q&A
  // turns we didn't know about (signature match), (c) re-apply highlights.
  // ---------------------------------------------------------------------------

  var mountObserver = null;
  var mountTimer = null;
  var observedRoot = null;

  function onTurnsMounted() {
    mountTimer = null;
    var turns = JR.site.turns();
    var newlyLoaded = [];
    for (var i = 0; i < turns.length; i++) {
      var key = JR.site.turnKey(turns[i]);
      if (!key) continue;
      if (st.hiddenTurnKeys.has(key)) {
        if (!cache.has(key) && !(st.watchingTurnKey === key)) {
          var h = harvest(turns[i]);
          if (h && h.responseHTML) { cache.set(key, h); newlyLoaded.push(key); }
        }
      } else if (!st.responseWatchActive && st.restoreReady) {
        // Self-healing: a Popup question we have no record of (data saved before
        // the redesign, lost storage). Hide it, cache it, and attach it to its highlight.
        var msg = JR.site.userText(turns[i]);
        var parsed = msg ? JR.parsePopupMessage(msg) : null;
        if (parsed) {
          JR.hideTurnKeys([key]);
          addDeletedTurns(location.href, [key]);
          var hv = harvest(turns[i]);
          if (hv && hv.responseHTML) { cache.set(key, hv); newlyLoaded.push(key); }
          if (JR.adoptPopupTurn) JR.adoptPopupTurn(key, parsed);
        }
      }
    }
    updateTail(turns);
    if (newlyLoaded.length && JR.onQAContentLoaded) JR.onQAContentLoaded(newlyLoaded);
    if (JR.reapplyHighlights) JR.reapplyHighlights();
    refreshDiagnosticsSoon();
  }

  // Keep #jr-diagnostics current for DOM-only test tools: refresh after turns
  // mount and once scrolling settles (debounced; nothing runs while idle).
  var diagTimer = null;
  function refreshDiagnosticsSoon() {
    if (diagTimer) clearTimeout(diagTimer);
    diagTimer = setTimeout(function () { diagTimer = null; JR.diagnose(); }, 500);
  }

  function scheduleMountCheck() {
    if (JR.perf) JR.perf.count("mountObserver");
    if (mountTimer) return;
    mountTimer = setTimeout(onTurnsMounted, 120);
  }

  // When ChatGPT loads older history above, the popup host grows and every
  // highlight moves down; absolutely positioned popups must follow.
  var hostObserver = null;
  var observedHost = null;
  var lastHostH = 0;
  function watchHostHeight() {
    if (typeof ResizeObserver === "undefined") return;
    var host = JR.site.popupHost(null);
    if (!host || host === observedHost || host === document.body) return;
    if (hostObserver) hostObserver.disconnect();
    observedHost = host;
    lastHostH = host.offsetHeight;
    hostObserver = new ResizeObserver(function () {
      var h = observedHost.offsetHeight;
      if (h === lastHostH) return;
      lastHostH = h;
      if (st.activePopup && st.activePopup.isConnected && JR.repositionPopup) JR.repositionPopup();
    });
    hostObserver.observe(host);
  }

  /** Run the mount pass now (after restore has loaded the stored items). */
  JR.recheckTurns = function () { scheduleMountCheck(); };

  /** (Re)attach the observer to the current scroll container. Safe to call often. */
  JR.watchTurnMounts = function () {
    var root = JR.site.scrollContainer();
    if (!root || root === observedRoot) return;
    if (mountObserver) mountObserver.disconnect();
    if (observedRoot) observedRoot.removeEventListener("scroll", refreshDiagnosticsSoon);
    observedRoot = root;
    mountObserver = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n.nodeType !== 1) continue;
          if (n.closest && n.closest(".jr-popup")) continue;
          if (n.matches(JR.SEL.turn) || n.querySelector(JR.SEL.turn)) {
            scheduleMountCheck();
            return;
          }
        }
      }
    });
    mountObserver.observe(root, { childList: true, subtree: true });
    watchHostHeight();
    root.addEventListener("scroll", refreshDiagnosticsSoon, { passive: true });
    scheduleMountCheck();
  };

  // ---------------------------------------------------------------------------
  // Markdown → HTML, for answers read from ChatGPT's network stream (net-tap.js)
  // when the answer's turn isn't in the DOM. ChatGPT's own rendered HTML is
  // always preferred when available. Everything is escaped first; only
  // http(s) links are kept. Handles the common subset: headings, paragraphs,
  // lists (nested by indent), code fences, blockquotes, tables, hr, inline
  // code/bold/italic/strike/links. Unclosed fences (mid-stream) render as code.
  // ---------------------------------------------------------------------------

  function esc(t) {
    return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function inline(t) {
    var codes = [];
    t = esc(t).replace(/`([^`]+)`/g, function (_, c) { codes.push(c); return "\u0000" + (codes.length - 1) + "\u0000"; });
    t = t
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, function (_, a, b) { return "<strong>" + (a || b) + "</strong>"; })
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
      .replace(/(^|[^\w_])_([^_\s][^_]*)_(?!\w)/g, "$1<em>$2</em>")
      .replace(/~~([^~]+)~~/g, "<del>$1</del>");
    return t.replace(/\u0000(\d+)\u0000/g, function (_, i) { return "<code>" + codes[+i] + "</code>"; });
  }

  JR.renderMarkdown = function (md) {
    var lines = (md || "").replace(/\r/g, "").split("\n");
    var out = [];
    var para = [];
    var lists = []; // stack of { type, indent }

    function flushPara() {
      if (para.length) { out.push("<p>" + inline(para.join(" ")) + "</p>"); para = []; }
    }
    function closeLists(toIndent) {
      while (lists.length && lists[lists.length - 1].indent >= toIndent) out.push("</li></" + lists.pop().type + ">");
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var fence = /^\s*```(\S*)/.exec(line);
      if (fence) {
        flushPara(); closeLists(0);
        var code = [];
        for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
        out.push("<pre><code" + (fence[1] ? ' class="language-' + esc(fence[1]) + '"' : "") + ">" + esc(code.join("\n")) + "</code></pre>");
        continue;
      }
      if (!line.trim()) { flushPara(); continue; }
      var h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) { flushPara(); closeLists(0); out.push("<h" + h[1].length + ">" + inline(h[2]) + "</h" + h[1].length + ">"); continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flushPara(); closeLists(0); out.push("<hr>"); continue; }
      if (/^\s*>/.test(line)) {
        flushPara(); closeLists(0);
        var quote = [];
        for (; i < lines.length && /^\s*>/.test(lines[i]); i++) quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i--;
        out.push("<blockquote>" + JR.renderMarkdown(quote.join("\n")) + "</blockquote>");
        continue;
      }
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
        flushPara(); closeLists(0);
        var cells = function (l) { return l.trim().replace(/^\||\|$/g, "").split("|").map(function (c) { return inline(c.trim()); }); };
        var head = cells(line);
        var rows = [];
        for (i += 2; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) rows.push(cells(lines[i]));
        i--;
        out.push("<table><thead><tr><th>" + head.join("</th><th>") + "</th></tr></thead><tbody>" +
          rows.map(function (r) { return "<tr><td>" + r.join("</td><td>") + "</td></tr>"; }).join("") + "</tbody></table>");
        continue;
      }
      var li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
      if (li) {
        flushPara();
        var indent = li[1].length;
        var type = /\d/.test(li[2]) ? "ol" : "ul";
        var top = lists[lists.length - 1];
        if (!top || indent > top.indent) {
          out.push("<" + type + "><li>");
          lists.push({ type: type, indent: indent });
        } else {
          closeLists(indent + 1);
          top = lists[lists.length - 1];
          if (top && top.indent === indent && top.type === type) out.push("</li><li>");
          else { if (top && top.indent === indent) out.push("</li></" + lists.pop().type + ">"); out.push("<" + type + "><li>"); lists.push({ type: type, indent: indent }); }
        }
        out.push(inline(li[3]));
        continue;
      }
      if (lists.length && /^\s+\S/.test(line)) { out.push(" " + inline(line.trim())); continue; } // list item continuation
      closeLists(0);
      para.push(line.trim());
    }
    flushPara(); closeLists(0);
    return out.join("");
  };

  // ---------------------------------------------------------------------------
  // Perf counters (read by JR.diagnose / TEST-PLAN layer 4)
  // ---------------------------------------------------------------------------

  var counters = {};
  var since = Date.now();
  JR.perf = {
    count: function (name) { counters[name] = (counters[name] || 0) + 1; },
    time: function (name, ms) {
      var t = counters[name + "Ms"] || { n: 0, total: 0, max: 0 };
      t.n++; t.total += ms; if (ms > t.max) t.max = ms;
      counters[name + "Ms"] = t;
    },
    snapshot: function () {
      var out = { seconds: Math.round((Date.now() - since) / 1000) };
      Object.keys(counters).forEach(function (k) { out[k] = counters[k]; });
      return out;
    },
    reset: function () { counters = {}; since = Date.now(); },
  };

  // Main-thread long tasks (>50 ms) on the page, whoever caused them — the
  // number users feel as "the page got slow".
  try {
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (e) { JR.perf.time("longTask", Math.round(e.duration)); });
    }).observe({ type: "longtask", buffered: false });
  } catch (e) { /* longtask not supported */ }
})();

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
  // Claude Code (user 2026-11-20): a Popup question is a question — its tool steps would be hidden with the Q&A, so
  // the agent is asked not to change anything; a preview or image to show is fine (user: "图片还是得支持").
  // In the same "(For this response only: …)" part: parsed off with it.
  var ANSWER_ONLY = SUFFIX_MARK + " don't change the project's files or run commands that change anything (making a preview or an image to show here is fine);";

  /**
   * Build the message Popup injects into ChatGPT.
   * @param {object} o - { question, text, sentence, wholeResponse, wholeResponseFull, mode }
   */
  JR.buildMessage = function (o) {
    if (!o.question || !String(o.question).trim()) throw new Error("Popup: refusing to send an empty question");
    // A blank line inside the question would read as a section break to
    // JR.parsePopupMessage (which splits on them): keep single line breaks only.
    o = Object.assign({}, o, { question: String(o.question).replace(/\r/g, "").replace(/\n\s*\n+/g, "\n").trim() });
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
    var suffix = LENGTH_SUFFIX[o.mode] || LENGTH_SUFFIX.medium;
    if (JR.site.answerOnly && JR.site.answerOnly()) suffix = suffix.replace(SUFFIX_MARK, ANSWER_ONLY);
    return message + suffix;
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
  // Hiding: one <style> with a rule per hidden turn key (JR.site.hideDeclaration).
  // CSS applies to a turn the instant React (re)mounts it, so virtualized
  // turns never flash and no observer has to re-add classes.
  // ---------------------------------------------------------------------------

  st.hiddenTurnKeys = new Set();
  var hideStyle = null;

  function renderHideStyle() {
    var rules = [];
    st.hiddenTurnKeys.forEach(function (k) {
      // Only the turn. Its virtualizer slot keeps ~1px + 12px gap; hiding or
      // shrinking the slot makes ChatGPT's list disagree with the page, and
      // correcting that made the thread jump while scrolling (1.2.0-dev.15–21).
      var sel = JR.site.turnSelector(k);
      if (sel) rules.push(sel);
    });
    if (!hideStyle || !hideStyle.isConnected) {
      hideStyle = document.getElementById("jr-hide-turns") || document.createElement("style");
      hideStyle.id = "jr-hide-turns";
      (document.head || document.documentElement).appendChild(hideStyle);
    }
    hideStyle.textContent = rules.length ? rules.join(",\n") + " { " + JR.site.hideDeclaration + " }" : "";
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
  // Session cache: turnKey → { question, text, sentence, isPopup, answerText } — the Q&A as read back from the site
  // (the question a finished item no longer stores; the answer as text, for ordering highlights only). Never a drawing:
  // a popup shows the site answer from its original (site-answer.js).
  // ---------------------------------------------------------------------------

  var cache = new Map();

  /** A mounted Q&A turn as read from the DOM, or null while it has no answer yet. */
  function harvest(turn) {
    if (JR.site.renderFailed(turn)) return null; // ChatGPT's own render failure text is not the answer
    var parsed = JR.parsePopupMessage(JR.site.userText(turn));
    var text = JR.site.assistantText(turn).trim();
    if (!text) return null;
    return {
      question: parsed ? parsed.question : null,
      text: parsed ? parsed.text : null,
      sentence: parsed ? parsed.sentence : null,
      answerText: text,
      isPopup: !!parsed,
    };
  }

  JR.qa = {
    cacheSize: function () { return cache.size; },
    clear: function () { cache.clear(); },

    /** The answer's text, for ordering highlights in it: as drawn on the page when its turn is mounted, else as read
     *  from the site's data (Markdown). Null if neither is at hand. */
    text: function (turnKeys) {
      for (var i = 0; i < (turnKeys || []).length; i++) {
        var t = JR.site.findTurnByKey(turnKeys[i]), h = t && harvest(t);
        if (h) return h.answerText;
      }
      var c = JR.qa.get(turnKeys);
      return c ? c.answerText || null : null;
    },

    /** The question an item asked, as read back. */
    question: function (turnKeys) {
      for (var i = 0; i < (turnKeys || []).length; i++) {
        var c = cache.get(turnKeys[i]);
        if (c && c.question != null) return c.question;
      }
      var g = JR.qa.get(turnKeys);
      return g ? g.question : null;
    },

    /** The Q&A with these turn keys as read back (cache, else its mounted turn), or null. */
    get: function (turnKeys) {
      for (var i = 0; i < (turnKeys || []).length; i++) {
        var k = turnKeys[i];
        var c = cache.get(k);
        if (c) return c;
        var turn = JR.site.findTurnByKey(k);
        var h = turn && harvest(turn);
        if (h) {
          if (!JR.site.isGenerating()) cache.set(k, h);
          return h;
        }
      }
      return null;
    },

    /** Store a Q&A read at the end of streaming. */
    put: function (turnKey, content) {
      if (turnKey && content) cache.set(turnKey, content);
    },

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

  /** GET a ChatGPT backend URL as the signed-in user (the page's own session token). */
  function apiGet(url) {
    return fetch("/api/auth/session", { credentials: "include" })
      .then(function (r) { return r.json(); })
      .then(function (session) {
        if (!session || !session.accessToken) throw new Error("no session token");
        return fetch(url, { credentials: "include", headers: { Authorization: "Bearer " + session.accessToken } });
      });
  }

  function fetchConversation() {
    var id = JR.site.conversationId();
    if (!id || JR.site.name !== "chatgpt") return Promise.resolve(null); // ChatGPT's REST API only
    if (convFetch && convFetch.id === id) return convFetch.promise;
    JR.qa.apiStatus = "loading";
    var promise = apiGet("/backend-api/conversation/" + id)
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
   * The attachments of a Popup question ({ id, name, mime }), from the conversation
   * data: user message metadata.attachments (verified T7). Empty if unknown.
   */
  JR.qa.attachmentsOf = function (turnKey) {
    if (JR.site.sentAttachments) return Promise.resolve(JR.site.sentAttachments(turnKey)); // read from the page
    if (JR.site.name === "deepseek") return dsAttachments(turnKey);
    return fetchConversation().then(function (conv) {
      var node = conv && conv.mapping[turnKey];
      var list = node && node.message && node.message.metadata && node.message.metadata.attachments;
      return (list || []).map(function (a) { return { id: a.id, name: a.name || "file", mime: a.mime_type || "" }; });
    });
  };

  /**
   * A short-lived address for an uploaded file (to show an image again), asked once
   * per file this session (JR.qa.forgetFileUrl once it stops working). Null if unavailable.
   */
  var fileUrls = new Map();
  JR.qa.fileUrl = function (fileId) {
    if (JR.site.name !== "chatgpt") return Promise.resolve(null);
    if (!fileUrls.has(fileId)) fileUrls.set(fileId, apiGet("/backend-api/files/download/" + encodeURIComponent(fileId))
      .then(function (r) { JR.qa.fileUrlStatus = "HTTP " + r.status; return r.ok ? r.json() : null; })
      .then(function (j) { return (j && j.download_url) || null; })
      .catch(function (e) { JR.qa.fileUrlStatus = "failed: " + (e && e.message); return null; }));
    return fileUrls.get(fileId);
  };
  JR.qa.forgetFileUrl = function (fileId) { fileUrls.delete(fileId); };

  /**
   * Read these Q&A turns from the conversation data into the session cache,
   * then let open popups refresh. Resolves to the keys that were filled.
   */
  JR.qa.ensure = function (turnKeys) {
    var want = (turnKeys || []).filter(function (k) { return k && !cache.has(k); });
    if (!want.length) return Promise.resolve([]);
    var read = { chatgpt: readChatGPT, deepseek: readDeepSeek, claude: readClaude }[JR.site.name];
    return (read ? read(want) : Promise.resolve([])).then(function (filled) {
      if (filled.length && JR.onQAContentLoaded) JR.onQAContentLoaded(filled);
      return filled;
    });
  };

  /** A Q&A read from the site's data: its question, and its answer as text only (ordering highlights in it). */
  function putParsed(k, questionText, answerText) {
    var parsed = JR.parsePopupMessage(questionText || "");
    cache.set(k, {
      question: parsed ? parsed.question : null,
      text: parsed ? parsed.text : null,
      sentence: parsed ? parsed.sentence : null,
      answerText: answerText,
      isPopup: !!parsed,
    });
  }

  function readChatGPT(want) {
    return fetchConversation().then(function (conv) {
      if (!conv) return [];
      return want.filter(function (k) {
        var node = conv.mapping[k];
        var answer = node && node.message && answerFor(conv.mapping, k);
        if (answer) putParsed(k, textOf(node.message), answer);
        return !!answer;
      });
    });
  }

  // DeepSeek (docs/DEEPSEEK.md §6–7): the key is the answer's message id, its question is the parent message.
  function dsText(m) {
    if (typeof m.content === "string" && m.content) return m.content;
    return (m.fragments || []).map(function (f) { return typeof f.content === "string" ? f.content : ""; }).join("");
  }
  /** DeepSeek's history / claude.ai's conversation, as the page loads them: once per conversation per page session,
   *  again after a failure; nothing stored. */
  var siteConv = null; // { id, promise }
  function siteData() {
    var conv = JR.site.conversationId();
    if (!conv) return Promise.resolve(null);
    if (!siteConv || siteConv.id !== conv) {
      var c = siteConv = { id: conv, promise: (JR.site.fetchHistory || JR.site.fetchConversation)(conv).catch(function () { return null; }) };
      c.promise.then(function (d) { if (!d && siteConv === c) siteConv = null; }); // retry later
    }
    return siteConv.promise;
  }
  /** Files the question of answer k carried (its FILE fragment): { id, name, mime, url } — after a reload. */
  function dsAttachments(k) {
    return siteData().then(function (msgs) {
      var a = (msgs || []).filter(function (m) { return String(m.message_id) === String(k); })[0];
      var q = a && (msgs || []).filter(function (m) { return m.message_id === a.parent_id; })[0];
      var files = [];
      ((q && q.fragments) || []).forEach(function (f) { if (f.type === "FILE") files = files.concat(f.files || []); });
      return files.map(function (f) {
        return { id: f.id, name: f.file_name || "file", mime: f.is_image ? "image/" : "", url: f.is_image ? JR.site.filePreviewUrl(f.signed_path) : null };
      });
    });
  }
  function readDeepSeek(want) {
    return siteData().then(function (msgs) {
      if (!msgs) return [];
      var byId = {};
      msgs.forEach(function (m) { byId[String(m.message_id)] = m; });
      return want.filter(function (k) {
        var a = byId[String(k)], md = a && JR.site.answerMarkdown(a);
        if (md) putParsed(k, byId[String(a.parent_id)] ? dsText(byId[String(a.parent_id)]) : "", md);
        return !!md;
      });
    });
  }

  // claude.ai (sites/claude.js fetchConversation)
  function readClaude(want) {
    return siteData().then(function (d) {
      return want.filter(function (k) {
        var t = d && d.turns[k];
        if (t && t.answer) putParsed(k, t.question, t.answer);
        return !!(t && t.answer);
      });
    });
  }

  /**
   * The text of the answer in the turn with this key, from the site's own data (Markdown), for ordering highlights in
   * answers that aren't on the page (navigation): ChatGPT's conversation, DeepSeek's history, claude.ai's conversation.
   */
  JR.qa.answerText = function (turnKey) {
    if (JR.site.name === "chatgpt") return fetchConversation().then(function (conv) { return conv ? answerFor(conv.mapping, turnKey) || null : null; });
    if (JR.site.name === "deepseek") {
      return siteData().then(function (msgs) {
        var m = (msgs || []).filter(function (x) { return String(x.message_id) === String(turnKey); })[0];
        return m ? JR.site.answerMarkdown(m) : null;
      });
    }
    if (JR.site.name === "claude") return siteData().then(function (d) { var t = d && d.turns[turnKey]; return t ? t.answer : null; });
    return Promise.resolve(null);
  };

  /**
   * Every Popup-format question in the conversation data, as { turnKey, parsed }.
   * Lets old or unlinked items be matched to their Q&A without scrolling to it.
   */
  /**
   * A message just sent and its answer, read fresh from the conversation (ChatGPT): { turnKey, text, media } of the
   * newest user message with exactly this text, or null. For a send whose stream ended before the answer (a thinking
   * model resumes it elsewhere, live 2026-11-20).
   */
  JR.qa.answerFor = function (message) {
    convFetch = null; // (fresh: the cached copy is from before the send)
    return fetchConversation().then(function (conv) {
      if (!conv) return null;
      var want = String(message || "").trim(), best = null;
      Object.keys(conv.mapping).forEach(function (id) {
        var m = conv.mapping[id].message;
        if (m && m.author && m.author.role === "user" && textOf(m).trim() === want && (!best || (m.create_time || 0) >= best.t)) best = { id: id, t: m.create_time || 0 };
      });
      if (!best) return null;
      var text = "", media = false;
      (function walk(id) {
        var node = conv.mapping[id];
        (node && node.children || []).forEach(function (c) {
          var m = conv.mapping[c] && conv.mapping[c].message;
          if (m && m.author && m.author.role === "user") return; // (the next turn)
          var ps = (m && m.content && m.content.parts) || [];
          if (m && m.author.role === "assistant" && m.content.content_type === "text") text += ps.filter(function (x) { return typeof x === "string"; }).join("");
          if (ps.some(function (x) { return x && typeof x === "object" && /image_asset_pointer/.test(x.content_type || ""); })) media = true;
          walk(c);
        });
      })(best.id);
      return text.trim() || media ? { turnKey: best.id, text: text, media: media } : null;
    });
  };

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

  /**
   * Turn keys of the conversation in order (current branch), from the
   * conversation data: a turn's key is its user message id. Cached in
   * JR.qa.turnOrderCache once loaded; resolves to [] if unavailable.
   */
  JR.qa.turnOrderCache = null;
  JR.qa.turnOrder = function () {
    if (JR.site.name === "claude") {
      var id = JR.site.conversationId();
      return siteData().then(function (d) {
        var order = d ? d.order : [];
        if (JR.site.conversationId() === id) JR.qa.turnOrderCache = order; // a failure as [] too (as below)
        return order;
      });
    }
    return fetchConversation().then(function (conv) {
      // Cache the empty result too: callers re-render when this resolves, and an
      // uncached [] made them fetch again forever (home page, API failure).
      // resetApi() clears the cache on navigation.
      if (!conv) { JR.qa.turnOrderCache = []; return []; }
      var order = branchUserIds(conv);
      JR.qa.turnOrderCache = order;
      return order;
    });
  };

  /** ChatGPT: the user message ids of the branch shown (= its turn keys), in order. */
  function branchUserIds(conv) {
    var order = [];
    var node = conv.mapping[conv.current_node];
    for (var guard = 0; node && guard < 100000; guard++) {
      var m = node.message;
      if (m && m.author && m.author.role === "user") order.push(node.id);
      node = node.parent ? conv.mapping[node.parent] : null;
    }
    return order.reverse();
  }

  /**
   * The conversation as the site's own data has it, one shape on every site: { order: [turn key] (the branch shown),
   * turns: { key: { question, answer } } } — the question as it was sent, the answer as text / Markdown. Null when
   * unavailable (Claude Code on the web: no data source known; the page's rows only).
   */
  /** Whether this page's conversation can be read from the site's data (JR.qa.conversation). */
  JR.qa.hasConversation = function () {
    return JR.site.name === "chatgpt" || JR.site.name === "deepseek" || (JR.site.name === "claude" && !/^session_/.test(JR.site.conversationId() || ""));
  };

  JR.qa.conversation = function () {
    if (JR.site.name === "chatgpt") {
      return fetchConversation().then(function (conv) {
        if (!conv) return null;
        var order = branchUserIds(conv), turns = {};
        order.forEach(function (k) { turns[k] = { question: textOf(conv.mapping[k].message), answer: answerFor(conv.mapping, k) }; });
        return { order: order, turns: turns };
      });
    }
    if (JR.site.name === "deepseek") {
      return siteData().then(function (msgs) {
        if (!msgs || !msgs.length) return null;
        var byId = {}, tip = null;
        msgs.forEach(function (m) { byId[String(m.message_id)] = m; if (!tip || Number(m.message_id) > Number(tip.message_id)) tip = m; });
        var chain = []; // the branch shown ends at the newest message
        for (var m = tip, g = 0; m && g < 100000; g++) { chain.push(m); m = m.parent_id != null ? byId[String(m.parent_id)] : null; }
        var order = [], turns = {};
        chain.reverse().forEach(function (a) {
          if (a.role !== "ASSISTANT") return; // a turn's key is its answer's id; its question the parent
          var q = byId[String(a.parent_id)], k = String(a.message_id);
          order.push(k);
          turns[k] = { question: q ? dsText(q) : "", answer: JR.site.answerMarkdown(a) };
        });
        return { order: order, turns: turns };
      });
    }
    if (JR.site.name === "claude") return siteData();
    return Promise.resolve(null);
  };

  JR.qa.resetApi = function () { convFetch = null; siteConv = null; JR.qa.apiStatus = "unused"; JR.qa.turnOrderCache = null; };

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
    if (!JR.site.isChatPage()) return; // R8: never hides or saves anything outside chats
    var turns = JR.site.turns();
    var newlyLoaded = [];
    for (var i = 0; i < turns.length; i++) {
      var key = JR.site.turnKey(turns[i]);
      if (!key) continue;
      if (st.hiddenTurnKeys.has(key)) {
        if (!cache.has(key) && !(st.watchingTurnKey === key)) {
          var h = harvest(turns[i]);
          if (h) { cache.set(key, h); newlyLoaded.push(key); }
        }
      } else if (!st.responseWatchActive && st.restoreReady) {
        // Self-healing: a Popup question we have no record of (data saved before
        // the redesign, lost storage). Hide it, cache it, and attach it to its highlight.
        var msg = JR.site.userText(turns[i]);
        var parsed = msg ? JR.parsePopupMessage(msg) : null;
        if (parsed) {
          JR.hideTurnKeys([key]);
          // stored as hidden only where the conversation can't be read (Claude Code): elsewhere the restore stores it
          // as an item from the conversation (highlight.js rebuildFromConversation) — as "hidden" it never would be
          if (!JR.qa.hasConversation()) addDeletedTurns(location.href, [key]);
          var hv = harvest(turns[i]);
          if (hv) { cache.set(key, hv); newlyLoaded.push(key); }
          if (JR.adoptPopupTurn) JR.adoptPopupTurn(key, parsed);
        }
      }
    }
    updateTail(turns);
    // ChatGPT may have replaced the element that hosts popups: watch the new one, put popups back into it
    watchHostHeight();
    if (st.activePopup && !st.activePopup.isConnected && JR.repositionAll) JR.repositionAll();
    if (newlyLoaded.length && JR.onQAContentLoaded) JR.onQAContentLoaded(newlyLoaded);
    if (JR.reapplyHighlights) JR.reapplyHighlights();
    refreshDiagnosticsSoon();
  }

  // #jr-diagnostics for DOM-only test tools: written once a chat's turns mount; kept current (after turns
  // mount, once scrolling settles) only with a #jr-… debug hash, since it walks the whole page (~30 ms in a
  // long chat). Otherwise tools click #jr-diagnostics-run for a fresh one.
  var diagTimer = null, diagDone = false;
  function refreshDiagnosticsSoon() {
    if (diagDone && location.hash.indexOf("jr-") === -1) return;
    diagDone = true;
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
  var lastHostH = 0, lastHlY = null;
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
      var hl = st.activePopup && st.activePopup.isConnected && st.activeSourceHighlights[0];
      if (!hl || !hl.isConnected || !JR.repositionAll) return;
      // Only when the highlight moved (older history loaded above), not for an answer growing below it
      var y = hl.getBoundingClientRect().top - observedHost.getBoundingClientRect().top;
      if (y === lastHlY) return;
      lastHlY = y;
      JR.repositionAll();
    });
    hostObserver.observe(host);
  }

  /** Run the mount pass now (after restore has loaded the stored items). */
  JR.recheckTurns = function () { scheduleMountCheck(); };

  /** (Re)attach the observer to the current scroll container. Safe to call often. */
  JR.watchTurnMounts = function () {
    if (!JR.site.isChatPage()) { // R8: no page observers outside chats
      if (mountObserver) mountObserver.disconnect();
      if (observedRoot) observedRoot.removeEventListener("scroll", refreshDiagnosticsSoon);
      mountObserver = null; observedRoot = null;
      return;
    }
    var root = JR.site.scrollContainer();
    if (!root || root === observedRoot) return;
    if (mountObserver) mountObserver.disconnect();
    if (observedRoot) observedRoot.removeEventListener("scroll", refreshDiagnosticsSoon);
    observedRoot = root;
    mountObserver = new MutationObserver(function (mutations) {
      var checked = new Set(); // a streaming answer adds many nodes per callback: each turn once
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
          // An answer filled in after its turn mounted, while a highlight still waits for it
          // (never restored yet, or lost when ChatGPT rebuilt the turn)
          var nt = n.closest && n.closest(JR.SEL.turn);
          if (!nt || checked.has(nt)) continue;
          checked.add(nt);
          if (JR.restoreWaitsFor && JR.restoreWaitsFor(nt)) {
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
    /** Wrap fn so each call's duration is recorded under name (ms: n/total/max). */
    timed: function (name, fn) {
      return function () {
        var t0 = performance.now();
        try { return fn.apply(this, arguments); }
        finally { JR.perf.time(name, Math.round((performance.now() - t0) * 10) / 10); }
      };
    },
  };

  // Measurement mode (URL contains #jr-perf; off for normal use): records every
  // frame while the user scrolls — frame gap, scroll position, list height,
  // into #jr-perflog[data-json] for DOM-only test tools.
  (function perfMode() {
    var frames = [], scrollUntil = 0, last = 0, running = false, lastTop = null;
    function on() { return location.hash.indexOf("jr-perf") !== -1; }
    function log() {
      var el = document.getElementById("jr-perflog");
      if (!el) { el = document.createElement("div"); el.id = "jr-perflog"; el.hidden = true; document.body.appendChild(el); }
      var gaps = frames.map(function (f) { return f.gap; });
      el.setAttribute("data-json", JSON.stringify({
        frames: frames.length,
        gapsOver50: gaps.filter(function (g) { return g > 50; }).length,
        gapsOver100: gaps.filter(function (g) { return g > 100; }).length,
        maxGap: gaps.length ? Math.max.apply(null, gaps) : 0,
        perf: JR.perf.snapshot(),
        log: frames.slice(-1500),
      }));
    }
    function frame(t) {
      var sc = JR.site.scrollContainer();
      if (sc) {
        var top = Math.round(sc.scrollTop);
        frames.push({
          t: Math.round(t), gap: last ? Math.round(t - last) : 0, top: top,
          dTop: lastTop == null ? 0 : top - lastTop, sh: sc.scrollHeight,
          turns: JR.site.turns().length,
        });
        lastTop = top;
        if (frames.length > 3000) frames.shift();
      }
      last = t;
      if (performance.now() < scrollUntil) { requestAnimationFrame(frame); return; }
      running = false; last = 0; log();
    }
    document.addEventListener("scroll", function () {
      if (!on()) return;
      scrollUntil = performance.now() + 1500;
      if (!running) { running = true; requestAnimationFrame(frame); }
    }, { capture: true, passive: true });
  })();

  // Main-thread long tasks (>50 ms) on the page, whoever caused them — the
  // number users feel as "the page got slow".
  try {
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (e) { JR.perf.time("longTask", Math.round(e.duration)); });
    }).observe({ type: "longtask", buffered: false });
  } catch (e) { /* longtask not supported */ }

  // Time the per-mount work (needs JR.perf, defined above).
  onTurnsMounted = JR.perf.timed("mountPass", onTurnsMounted);
  harvest = JR.perf.timed("harvest", harvest);
})();

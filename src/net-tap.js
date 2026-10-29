// net-tap.js — Runs in the page's MAIN world (see manifest).
//
// ChatGPT virtualizes the thread: when the user asks from the middle of a long
// conversation, the new Q&A turn at the bottom is never put in the DOM, so the
// content script can't read the answer there. This script reads ChatGPT's own
// response stream instead — only for requests whose question is in Popup's
// message format; the user's normal messages are never looked at.
//
// It forwards plain strings to the content script via CustomEvent("jr-net"):
//   { kind: "start", question } / { kind: "turn", turnKey } / { kind: "text", text } / { kind: "done", text }
// and keeps the latest Popup request's first raw stream events in #jr-netlog[data-json] (truncated)
// so the stream format can be inspected when ChatGPT changes it.
(function () {
  "use strict";

  var origFetch = window.fetch;
  if (typeof origFetch !== "function") return;

  var POPUP_PREFIXES = ["Regarding this part of your response:", "Regarding your entire response below:", "Regarding your entire response above:"];
  var POPUP_SUFFIX = "(For this response only:";

  function isPopupQuestion(s) {
    if (!s) return false;
    s = String(s).trim();
    return POPUP_PREFIXES.some(function (p) { return s.indexOf(p) === 0; }) && s.indexOf(POPUP_SUFFIX) !== -1;
  }

  /** The user's question inside a conversation request body, if any. */
  function questionFromBody(body) {
    if (typeof body !== "string" || body.indexOf("Regarding") === -1) return null;
    try {
      var json = JSON.parse(body);
      var msgs = json.messages || (json.message ? [json.message] : []);
      for (var i = msgs.length - 1; i >= 0; i--) {
        // With attachments, parts = [image pointer(s)…, text]: keep the text parts (like partsText)
        var parts = msgs[i] && msgs[i].content && msgs[i].content.parts;
        var text = parts ? parts.filter(function (x) { return typeof x === "string"; }) : [];
        if (text.length) return text.join("\n");
      }
    } catch (e) { /* not JSON */ }
    return null;
  }

  /**
   * The shape of a request's user message, never its text: content type, the type of
   * each part, and the keys of each attachment (#jr-netlog; how attachments travel).
   */
  function bodyShape(body) {
    try {
      var j = JSON.parse(body), m = (j.messages || [])[0] || {};
      var parts = (m.content && m.content.parts) || [];
      return JSON.stringify({
        content_type: m.content && m.content.content_type,
        parts: parts.map(function (p) { return typeof p === "string" ? "text" : Object.keys(p).join("|") + ":" + p.content_type; }),
        attachments: ((m.metadata && m.metadata.attachments) || []).map(function (a) { return Object.keys(a).join("|") + ":" + a.mime_type; }),
      });
    } catch (e) { return "unreadable"; }
  }

  function emit(detail) {
    document.dispatchEvent(new CustomEvent("jr-net", { detail: JSON.stringify(detail) }));
  }

  var rawLog = [];
  function logRaw(url, line) {
    if (rawLog.length >= 40) return;
    rawLog.push({ url: String(url).slice(0, 120), line: line.slice(0, 400) });
    var el = document.getElementById("jr-netlog");
    if (!el && document.body) {
      el = document.createElement("div");
      el.id = "jr-netlog";
      el.hidden = true;
      document.body.appendChild(el);
    }
    if (el) el.setAttribute("data-json", JSON.stringify(rawLog));
  }

  /**
   * Accumulates the assistant's answer text from stream events. Handles the
   * snapshot format ({message:{author:{role},content:{parts}}}) and the delta
   * format ({p, o, v} with append/patch/replace and bare {v:"..."} appends).
   */
  function Accumulator() {
    this.text = "";
    this.lastPath = "";
    this.assistant = false;
  }
  Accumulator.prototype.message = function (m) {
    if (!m || !m.author) return;
    this.assistant = m.author.role === "assistant";
    var parts = m.content && m.content.parts;
    if (this.assistant && parts && typeof parts[0] === "string") this.text = parts.join("");
  };
  Accumulator.prototype.op = function (o) {
    if (o == null) return;
    if (o.p !== undefined) this.lastPath = o.p;
    var path = this.lastPath || "";
    // A bare array value is a batch of operations ({"v":[...]} with "o":"patch" omitted).
    if ((o.o === "patch" || !o.o) && Array.isArray(o.v)) { o.v.forEach(this.op, this); return; }
    var op = o.o || (typeof o.v === "string" && /parts\/0$/.test(path) ? "append" : null);
    if (o.v && typeof o.v === "object" && o.v.message) { this.message(o.v.message); return; }
    if (!/content\/parts\/0$/.test(path) || !this.assistant) return;
    if (op === "append" && typeof o.v === "string") this.text += o.v;
    else if ((op === "replace" || op === "add") && typeof o.v === "string") this.text = o.v;
  };
  Accumulator.prototype.event = function (obj) {
    if (!obj || typeof obj !== "object") return;
    // The echoed question; its id is the turn's data-turn-key in the DOM.
    if (obj.type === "input_message" && obj.input_message) { this.inputId = obj.input_message.id || null; return; }
    if (obj.message) this.message(obj.message);
    else if (obj.v !== undefined || obj.p !== undefined || obj.o !== undefined) this.op(obj);
  };

  async function tap(url, res, question) {
    var reader = res.body && res.body.getReader();
    if (!reader) return;
    var decoder = new TextDecoder();
    var buf = "";
    var acc = new Accumulator();
    var lastSent = "";
    var sentId = false;
    emit({ kind: "start", question: question });
    try {
      for (;;) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buf += decoder.decode(chunk.value, { stream: true });
        var lines = buf.split("\n");
        buf = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line) continue;
          logRaw(url, line);
          if (line.indexOf("data:") !== 0) continue;
          var data = line.slice(5).trim();
          if (data === "[DONE]") continue;
          try { acc.event(JSON.parse(data)); } catch (e) { /* not JSON */ }
        }
        if (acc.inputId && !sentId) {
          sentId = true;
          emit({ kind: "turn", turnKey: acc.inputId });
        }
        if (acc.text !== lastSent) {
          lastSent = acc.text;
          emit({ kind: "text", text: acc.text });
        }
      }
    } catch (e) {
      if (!(e && e.name === "AbortError")) logRaw(url, "ERROR " + e); // ChatGPT aborts the stream after [DONE]
    }
    emit({ kind: "done", text: acc.text });
  }

  // ---------------------------------------------------------------------------
  // Keep Popup Q&A out of the page (not out of ChatGPT's context).
  //
  // The page loads a conversation as pages of messages:
  //   GET /backend-api/conversations/<id>?num_turns=10 → { ...metadata, messages: [...], current_node, page_info }
  //   GET /backend-api/conversations/<id>/messages     → { messages: [...], page_info }
  // current_node is left as is (it may be a hidden Popup message — the real leaf).
  // Every turn's messages share metadata.turn_exchange_id. We drop whole turns
  // whose user message is a Popup question from what the PAGE receives, so
  // ChatGPT never renders them (no hidden rows, no gaps). The server
  // conversation is untouched: the model still sees every Popup Q&A.
  //
  // Because the page no longer knows those turns, its next message would be
  // attached after the last visible message, skipping them. Requests are
  // therefore checked: if hidden Popup messages sit between the parent the page
  // chose and the next visible message, the parent should be the last of them.
  // Verified live (T19): normal send, edit of an older message, regenerate.
  // #jr-nofilter in the URL turns both off (debugging; Popup then hides turns with CSS).
  // Anything unexpected in the format → nothing is filtered (status in #jr-filterlog).
  // ---------------------------------------------------------------------------

  function filterOn() { return location.hash.indexOf("jr-nofilter") === -1; }

  // What the page was given, per conversation, for the current load: the pages
  // as they arrived ("segments", each in the server's order = branch order), and
  // which messages were removed. Reset on every first-screen response, so it
  // only ever holds one branch: the one ChatGPT is showing.
  var convs = {};   // conversation id → { segs: [{ t0, items: [{ id, removed }] }] }
  function newStatus() { return { pages: 0, removedTurns: 0, removedMessages: 0, fallback: null, detail: [] }; }
  var filterStatus = newStatus();

  function writeNode(id, data) {
    var el = document.getElementById(id);
    if (!el && document.body) { el = document.createElement("div"); el.id = id; el.hidden = true; document.body.appendChild(el); }
    if (el) el.setAttribute("data-json", JSON.stringify(data));
  }

  function partsText(m) {
    var parts = m && m.content && m.content.parts;
    return parts ? parts.filter(function (x) { return typeof x === "string"; }).join("\n") : "";
  }

  /**
   * Filter one page of messages. firstScreen: the ?num_turns= response that
   * starts a load. Returns the JSON to give the page (or null = unchanged).
   */
  function filterPage(conv, j, firstScreen) {
    if (!j || !Array.isArray(j.messages)) { filterStatus.fallback = "no messages array"; return null; }
    // ChatGPT sometimes fetches the same first screen twice: that is not a new load.
    var firstIds = firstScreen ? j.messages.map(function (m) { return m && m.id; }).join() : null;
    var c = convs[conv];
    if (!c || (firstScreen && c.firstIds !== firstIds)) { c = convs[conv] = { segs: [], firstIds: firstIds }; filterStatus = newStatus(); }
    else if (firstScreen) c.segs = c.segs.filter(function (sg) { return !sg.first; }); // replaced below
    var drop = {};
    for (var i = 0; i < j.messages.length; i++) {
      var m = j.messages[i];
      if (!m || !m.author || m.author.role !== "user" || !isPopupQuestion(partsText(m))) continue;
      var ex = m.metadata && m.metadata.turn_exchange_id;
      if (!ex) { filterStatus.fallback = "Popup message without turn_exchange_id"; return null; }
      drop[ex] = true;
    }
    var isDropped = function (msg) { var e = msg && msg.metadata && msg.metadata.turn_exchange_id; return !!(e && drop[e]); };
    var kept = j.messages.filter(function (msg) { return !isDropped(msg); });

    var seg = { t0: null, items: [], first: !!firstScreen };
    j.messages.forEach(function (msg) {
      if (!msg || !msg.id) return;
      if (seg.t0 === null && msg.create_time) seg.t0 = msg.create_time;
      seg.items.push({ id: msg.id, removed: isDropped(msg) });
    });
    c.segs.push(seg);

    filterStatus.pages++;
    filterStatus.removedMessages += j.messages.length - kept.length;
    filterStatus.removedTurns += Object.keys(drop).length;
    if (filterStatus.detail.length >= 20) filterStatus.detail.shift();
    filterStatus.detail.push({ n: j.messages.length, kept: kept.length,
      first: j.messages[0] && String(j.messages[0].id).slice(0, 8), last: j.messages.length && String(j.messages[j.messages.length - 1].id).slice(0, 8),
      page_info: j.page_info ? { prev: j.page_info.has_previous_page, next: j.page_info.has_next_page } : null });
    writeNode("jr-filterlog", filterStatus);
    if (kept.length === j.messages.length) return null;
    var out = Object.assign({}, j);
    out.messages = kept;
    return out;
  }

  /**
   * The parent a message request should use. Returns null when the page's
   * choice is right: only when removed Popup messages come right after the
   * page's parent (before the next visible message) does it move to the last of them.
   * Order: each page in server order; pages placed by their first create_time
   * (along one branch every message is newer than its parent).
   */
  function correctParent(conv, parentId) {
    var c = convs[conv];
    if (!c || !parentId) return null;
    var segs = c.segs.slice().sort(function (a, b) { return (a.t0 || 0) - (b.t0 || 0); });
    var order = [], seen = {};
    segs.forEach(function (sg) { sg.items.forEach(function (it) { if (!seen[it.id]) { seen[it.id] = true; order.push(it); } }); });
    var i = -1;
    for (var n = 0; n < order.length; n++) if (order[n].id === parentId) { i = n; break; }
    if (i < 0) return null;
    var lastRemoved = null;
    for (var k = i + 1; k < order.length && order[k].removed; k++) lastRemoved = order[k].id;
    return lastRemoved;
  }

  var rewriteLog = [];
  /** Returns the request body to send: the same string, or one with the corrected parent. */
  function fixRequest(url, body) {
    var json;
    try { json = JSON.parse(body); } catch (e) { return body; }
    if (!json || !json.parent_message_id || !json.conversation_id) return body; // new chat: nothing hidden yet
    var fix = filterOn() ? correctParent(json.conversation_id, json.parent_message_id) : null;
    rewriteLog.push({
      t: new Date().toISOString(), url: String(url).split("?")[0].slice(-40), action: json.action || null,
      parent: String(json.parent_message_id).slice(0, 8), rewrittenTo: fix ? String(fix).slice(0, 8) : null,
      popupQuestion: isPopupQuestion(questionFromBody(body)), filterOn: filterOn(),
    });
    if (rewriteLog.length > 30) rewriteLog.shift();
    writeNode("jr-rewritelog", rewriteLog);
    if (!fix) return body;
    json.parent_message_id = fix;
    return JSON.stringify(json);
  }

  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();

    // Both carry message pages: /conversations/<id>?num_turns=… (first screen, plus metadata)
    // and /conversations/<id>/messages (older pages while scrolling up).
    var conv = /\/backend-api\/conversations\/([0-9a-f-]{36})(?:\/messages)?(?:[?#]|$)/.exec(url);
    if (method === "GET" && conv && filterOn()) {
      return origFetch.apply(this, arguments).then(function (res) {
        if (!res.ok) return res;
        return res.clone().json().then(function (j) {
          var filtered = filterPage(conv[1], j, url.indexOf("/messages") === -1);
          if (!filtered) return res;
          return new Response(JSON.stringify(filtered), { status: res.status, statusText: res.statusText, headers: res.headers });
        }).catch(function () { return res; }); // unexpected body: give the page the original
      });
    }

    var question = null;
    // Any backend POST carrying a Popup question (the endpoint path has changed before).
    if (url.indexOf("/backend-api/") !== -1 && method === "POST" && typeof (init && init.body) === "string") {
      if (url.indexOf("conversation") !== -1) {
        var fixed = fixRequest(url, init.body);
        if (fixed !== init.body) init = Object.assign({}, init, { body: fixed });
      }
      var q = questionFromBody(init.body);
      if (isPopupQuestion(q)) { question = q; rawLog = []; logRaw(url, "request matched"); logRaw(url, "request shape " + bodyShape(init.body)); } // log = latest Popup request
    }
    var p = origFetch.call(this, input, init);
    if (!question) return p;
    return p.then(function (res) {
      try {
        var type = res.headers.get("content-type") || "";
        if (type.indexOf("event-stream") !== -1) tap(url, res.clone(), question);
        else logRaw(url, "non-stream response: " + type);
      } catch (e) { logRaw(url, "ERROR " + e); }
      return res;
    });
  };
})();

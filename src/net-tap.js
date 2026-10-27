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
        var parts = msgs[i] && msgs[i].content && msgs[i].content.parts;
        if (parts && typeof parts[0] === "string") return parts.join("\n");
      }
    } catch (e) { /* not JSON */ }
    return null;
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

  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var question = null;
    // Any backend POST carrying a Popup question (the endpoint path has changed before).
    if (url.indexOf("/backend-api/") !== -1 && init && init.method && init.method.toUpperCase() === "POST") {
      var q = questionFromBody(init.body);
      if (isPopupQuestion(q)) { question = q; rawLog = []; logRaw(url, "request matched"); } // log = latest Popup request
    }
    var p = origFetch.apply(this, arguments);
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

// deepseek-net.js — DeepSeek's network side, page (MAIN) world, chat.deepseek.com only. Step 4b.
//
// Same job and same events as net-tap.js on ChatGPT, so chat.js doesn't change:
//   CustomEvent("jr-net", {detail: JSON.stringify(e)}) with e.kind = "start" | "turn" | "text" | "done".
// DeepSeek needs no data filtering: CSS hiding leaves no gaps in its list (PLAN-next.md P3), so the
// Popup Q&A stays in the page and on the server and the next message follows it naturally.
//
// Send: POST /api/v0/chat/completion (XHR in 2026-10; fetch handled too), JSON body with `prompt`.
// Reply: SSE — first `event: ready` with {request_message_id, response_message_id} (the real ids; the
// page shows temporary negative keys until a reload), then patches {v} / {p,o,v} like ChatGPT's.
// The answer text is the RESPONSE part only: with DeepThink on, thinking streams first (separate path
// or fragment type) and is not part of the answer.
//
// While any completion streams, <html data-jr-ds-generating> is set (the site adapter's isGenerating).
(function () {
  "use strict";

  var POPUP_PREFIXES = ["Regarding this part of your response:", "Regarding your entire response below:", "Regarding your entire response above:"];
  var POPUP_SUFFIX = "(For this response only:";
  var COMPLETION = /\/api\/v0\/chat\/completion(?:[?#]|$)/;

  function isPopupQuestion(s) {
    if (!s) return false;
    s = String(s).trim();
    return POPUP_PREFIXES.some(function (p) { return s.indexOf(p) === 0; }) && s.indexOf(POPUP_SUFFIX) !== -1;
  }

  function emit(detail) {
    document.dispatchEvent(new CustomEvent("jr-net", { detail: JSON.stringify(detail) }));
  }

  var streams = 0;
  function generating(delta) {
    streams = Math.max(0, streams + delta);
    if (streams) document.documentElement.setAttribute("data-jr-ds-generating", "");
    else document.documentElement.removeAttribute("data-jr-ds-generating");
  }

  /**
   * The answer text from DeepSeek's SSE lines. Two shapes are handled:
   * - path patches: {"p":"response/content","o":"APPEND","v":"…"} (thinking: ".../thinking_content")
   * - fragments: {"p":"response/fragments","o":"APPEND","v":[{"type":"RESPONSE","content":"…"}]} then
   *   {"p":"response/fragments/-1/content","o":"APPEND","v":"…"}; type THINK is thinking
   * A bare {"v":"…"} continues the last path (as on ChatGPT).
   */
  function Answer() { this.path = ""; this.content = ""; this.fragments = []; this.ids = null; }
  Answer.prototype.text = function () {
    // only the answer's fragments: not THINK (reasoning), not SEARCH or other tool parts
    var f = this.fragments.filter(function (x) { return !x.type || /^response$/i.test(x.type); }).map(function (x) { return typeof x.content === "string" ? x.content : ""; }).join("");
    return this.content + f;
  };
  Answer.prototype.fragment = function (i) {
    if (i < 0) i = this.fragments.length + i;
    return this.fragments[i];
  };
  Answer.prototype.patch = function (o) {
    if (!o || typeof o !== "object") return;
    if (o.request_message_id != null || o.response_message_id != null) {
      this.ids = { request: String(o.request_message_id), response: String(o.response_message_id) };
      return;
    }
    if (o.p !== undefined) this.path = String(o.p);
    var op = String(o.o || "APPEND").toUpperCase(), v = o.v, p = this.path;
    // {"p":"response","o":"BATCH","v":[{"p":"quasi_status","v":"FINISHED"}, …]}: children relative to the parent
    if (op === "BATCH" || (Array.isArray(v) && v.length && v[0] && typeof v[0] === "object" && "p" in v[0])) {
      var base = o.p !== undefined ? String(o.p) : "";
      v.forEach(function (c) { if (c && typeof c === "object") this.patch({ p: base && c.p ? base + "/" + c.p : (c.p || base), o: c.o, v: c.v }); }, this);
      return;
    }
    if (Array.isArray(v) && /(^|\/)fragments$/.test(p)) { // new fragments
      if (op === "SET") this.fragments = [];
      v.forEach(function (f) { this.fragments.push({ type: f.type, content: f.content || "" }); }, this);
      return;
    }
    if (Array.isArray(v) && !p) { v.forEach(this.patch, this); return; } // a batch
    if (v && typeof v === "object" && v.response) { this.patch({ p: "response", o: "SET", v: v.response }); return; }
    if (v && typeof v === "object" && /(^|\/)response$/.test(p)) { // a whole response object
      if (typeof v.content === "string") this.content = v.content;
      if (Array.isArray(v.fragments)) this.fragments = v.fragments.map(function (f) { return { type: f.type, content: f.content || "" }; });
      return;
    }
    if (typeof v !== "string") return;
    var m = /fragments\/(-?\d+)\/content$/.exec(p);
    if (m) {
      var f = this.fragment(Number(m[1]));
      if (f) f.content = op === "SET" ? v : f.content + v;
      return;
    }
    if (/think/i.test(p)) return; // DeepThink's reasoning is not the answer
    if (/(^|\/)content$/.test(p) || !p) this.content = op === "SET" ? v : this.content + v;
  };

  /** Feed SSE text (cumulative), emit Popup events when popup is true. */
  function SSE(popup) { this.seen = 0; this.buf = ""; this.answer = new Answer(); this.popup = popup; this.lastText = ""; this.sentIds = false; }
  SSE.prototype.feed = function (all) {
    this.buf += all.slice(this.seen);
    this.seen = all.length;
    var lines = this.buf.split("\n");
    this.buf = lines.pop();
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.indexOf("data:") !== 0) continue;
      var data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try { this.answer.patch(JSON.parse(data)); } catch (e) { /* not JSON */ }
    }
    if (!this.popup) return;
    if (this.answer.ids && !this.sentIds) {
      this.sentIds = true;
      emit({ kind: "turn", turnKey: this.answer.ids.response, userKey: this.answer.ids.request });
    }
    var t = this.answer.text();
    if (t !== this.lastText) { this.lastText = t; emit({ kind: "text", text: t }); }
  };

  function promptOf(body) {
    if (typeof body !== "string") return null;
    try { return JSON.parse(body).prompt || null; } catch (e) { return null; }
  }

  // --- XHR (DeepSeek's send in 2026-10) ---
  var XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this._jrDs = String(method).toUpperCase() === "POST" && COMPLETION.test(String(url)) ? {} : null;
    return XO.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    var x = this, ds = x._jrDs;
    if (ds) {
      var q = promptOf(body), popup = isPopupQuestion(q), sse = new SSE(popup), ended = false;
      generating(1);
      if (popup) emit({ kind: "start", question: q });
      var read = function () { try { sse.feed(x.responseText || ""); } catch (e) { /* responseType not text */ } };
      var end = function () {
        if (ended) return;
        ended = true;
        read();
        generating(-1);
        if (popup) emit({ kind: "done", text: sse.answer.text() });
      };
      x.addEventListener("progress", read);
      x.addEventListener("loadend", end);
    }
    return XS.apply(this, arguments);
  };

  // --- fetch (in case DeepSeek moves the send to fetch) ---
  var origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : (input && input.url) || "";
      var method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
      if (method !== "POST" || !COMPLETION.test(url)) return origFetch.apply(this, arguments);
      var q = promptOf(init && init.body), popup = isPopupQuestion(q);
      generating(1);
      if (popup) emit({ kind: "start", question: q });
      return origFetch.apply(this, arguments).then(function (res) {
        var sse = new SSE(popup), all = "", copy = res.clone();
        var reader = copy.body && copy.body.getReader();
        if (!reader) { generating(-1); if (popup) emit({ kind: "done", text: "" }); return res; }
        var dec = new TextDecoder();
        (function pump() {
          reader.read().then(function (c) {
            if (c.done) { generating(-1); if (popup) emit({ kind: "done", text: sse.answer.text() }); return; }
            all += dec.decode(c.value, { stream: true });
            sse.feed(all);
            pump();
          }, function () { generating(-1); if (popup) emit({ kind: "done", text: sse.answer.text() }); });
        })();
        return res;
      }, function (e) { generating(-1); if (popup) emit({ kind: "done", text: "" }); throw e; });
    };
  }

  // Offline tests (tools/dom-test-deepseek.html) reach the parser through this.
  window.JRDeepSeekNet = { Answer: Answer, SSE: SSE, isPopupQuestion: isPopupQuestion };
})();

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
    return citeLinks(this.content + f, this.fragments);
  };
  /** Search answers mark sources as [citation:N] (N = a SEARCH fragment result's cite_index): a link "N" instead. */
  function citeLinks(md, fragments) {
    var url = {};
    (fragments || []).forEach(function (x) { (x.results || []).forEach(function (r) { if (r && r.cite_index != null && r.url) url[r.cite_index] = r.url; }); });
    return md.replace(/\[citation:(\d+)\]/g, function (m, n) { return url[n] ? "[" + n + "](" + url[n] + ")" : ""; });
  }
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
      // a batch without its own path continues the last one: {"v":[{"p":"content","v":"Found 11 web pages"}]}
      // after "response/fragments/-1" is the SEARCH fragment's status line, not the answer (live 2026-11-18)
      var base = o.p !== undefined ? String(o.p) : p;
      v.forEach(function (c) { if (c && typeof c === "object") this.patch({ p: base && c.p ? base + "/" + c.p : (c.p || base), o: c.o, v: c.v }); }, this);
      this.path = base; // the batch's own path is the last one (not its last child's)
      return;
    }
    if (Array.isArray(v) && /(^|\/)fragments$/.test(p)) { // new fragments
      if (op === "SET") this.fragments = [];
      v.forEach(function (f) { this.fragments.push({ type: f.type, content: f.content || "", results: f.results }); }, this);
      return;
    }
    var rm = /fragments\/(-?\d+)\/results$/.exec(p);
    if (rm && Array.isArray(v)) { var rf = this.fragment(Number(rm[1])); if (rf) rf.results = v; return; }
    if (Array.isArray(v) && !p) { v.forEach(this.patch, this); return; } // a batch
    if (v && typeof v === "object" && v.response) { this.patch({ p: "response", o: "SET", v: v.response }); return; }
    if (v && typeof v === "object" && /(^|\/)response$/.test(p)) { // a whole response object
      if (typeof v.content === "string") this.content = v.content;
      if (Array.isArray(v.fragments)) this.fragments = v.fragments.map(function (f) { return { type: f.type, content: f.content || "", results: f.results }; });
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
  function SSE(popup) {
    this.seen = 0; this.buf = ""; this.answer = new Answer(); this.popup = popup; this.lastText = ""; this.sentIds = false;
    if (popup) netlog.raw = [];
  }
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
      if (this.popup && netlog.raw.length < 60) { netlog.raw.push(data.slice(0, 300)); writeLog(); }
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

  /** The question in a completion body: a JSON string, or the same as bytes; a Blob is read later (async: null now). */
  function promptOf(body) {
    var text = typeof body === "string" ? body
      : body instanceof ArrayBuffer || ArrayBuffer.isView(body) ? new TextDecoder().decode(body) : null;
    if (text == null) return null;
    try { return JSON.parse(text).prompt || null; } catch (e) { return null; }
  }
  function blobPrompt(body) {
    return typeof Blob !== "undefined" && body instanceof Blob
      ? body.text().then(function (t) { try { return JSON.parse(t).prompt || null; } catch (e) { return null; } }, function () { return null; })
      : null;
  }
  // Testing: the last completion's body type and the latest Popup request's first raw lines in #jr-netlog[data-json]
  // (on the page, so DOM-only tools can read it — as on ChatGPT, net-tap.js)
  var netlog = { last: null, raw: [] };
  function writeLog() {
    var el = document.getElementById("jr-netlog");
    if (!el && document.body) { el = document.createElement("div"); el.id = "jr-netlog"; el.hidden = true; document.body.appendChild(el); }
    if (el) el.setAttribute("data-json", JSON.stringify(netlog));
  }
  function note(body, x) {
    netlog.last = { body: body == null ? String(body) : (body.constructor && body.constructor.name) || typeof body, responseType: x ? x.responseType : "fetch" };
    writeLog();
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
      note(body, x);
      var q = promptOf(body), sse = new SSE(isPopupQuestion(q)), ended = false;
      generating(1);
      if (sse.popup) emit({ kind: "start", question: q });
      var later = !q && blobPrompt(body);
      if (later) later.then(function (q2) { // a Blob body: the stream is cumulative, nothing is lost meanwhile
        if (ended || !isPopupQuestion(q2)) return;
        sse.popup = true; netlog.raw = [];
        emit({ kind: "start", question: q2 });
        read();
      });
      var read = function () { try { sse.feed(x.responseText || ""); } catch (e) { /* responseType not text */ } };
      var end = function () {
        if (ended) return;
        ended = true;
        read();
        generating(-1);
        if (sse.popup) emit({ kind: "done", text: sse.answer.text() });
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
      note(init && init.body, null);
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

  // --- Hidden Popup items must not use up DeepSeek's list window ---
  // Its message list draws ceil(listHeight / 60 + 1) items from the one at the top of the screen (main.js, 2026-11-18).
  // Popup's hidden items are 0 px but still take those slots: after a long answer and runs of them, the newer
  // messages were never drawn (blank at the bottom). The list reads listHeight as the list's offsetHeight in its
  // ResizeObserver callback, and only there; at that moment (only) the list reads taller by 60 px per hidden item it
  // will meet from its first drawn item until ~30 real ones (ids count up; hidden ids are in #jr-hide-turns), and far
  // enough to draw html[data-jr-ds-need] (a hidden answer Popup wants drawn, to copy DeepSeek's own rendering).
  // Every other read stays true (its "at the bottom" checks use it too). Measured again when that number changes.
  // The getter is on the list element itself: DeepSeek's fp.min.js checks that HTMLElement.prototype.offsetHeight is native.
  var NativeRO = window.ResizeObserver;
  var heightDesc = typeof HTMLElement === "function" && Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  if (NativeRO && heightDesc && heightDesc.get) {
    var measured = []; // { el, cb, obs, extra }: lists DeepSeek measures
    var hidSrc = null, hid = new Set();
    var hiddenIds = function () {
      var st = document.getElementById("jr-hide-turns"), t = st ? st.textContent : "";
      if (t !== hidSrc) {
        hidSrc = t; hid = new Set();
        (t.match(/item-key="\d+"/g) || []).forEach(function (m) { hid.add(Number(m.slice(10, -1))); });
      }
      return hid;
    };
    var extraFor = function (el) {
      var first = el.querySelector(".ds-virtual-list-visible-items > [data-virtual-list-item-key]");
      var start = first ? Number(first.getAttribute("data-virtual-list-item-key")) : NaN;
      if (!(start >= 0)) return 0;
      var h = hiddenIds(), need = Math.max.apply(null, (document.documentElement.getAttribute("data-jr-ds-need") || "0").split(" ").map(Number).filter(function (n) { return n >= 0; }).concat(0)), real = 0, hidden = 0;
      for (var id = start; id < start + 5000 && real < 30; id++) { if (h.has(id)) hidden++; else real++; }
      return 60 * Math.max(hidden, need > start ? need - start + 2 : 0);
    };
    var withTall = function (els, fn) {
      els.forEach(function (el) {
        if (!("_jrTall" in el)) {
          Object.defineProperty(el, "offsetHeight", { configurable: true, get: function () { var h = heightDesc.get.call(this); return this._jrTall ? h + this._jrExtra : h; } });
        }
        el._jrExtra = extraFor(el);
        el._jrTall = true;
      });
      var before = els.map(function (el) { return el.style.getPropertyValue("--container-height"); });
      try { return fn(); } finally {
        els.forEach(function (el, i) {
          el._jrTall = false;
          // its scroll area read the same height in the same measuring, for its scrollbar track: that much taller and
          // following the scroll, the track made the chat longer and blank at the bottom (live 2026-11-19) — the real one
          var v = el.style.getPropertyValue("--container-height");
          if (v === before[i] || !el._jrExtra || !(parseFloat(v) >= 0)) return; // (DeepSeek writes "<n>px" to both)
          var real = Math.max(0, parseFloat(v) - el._jrExtra) + "px";
          el.style.setProperty("--container-height", real);
          var g = el.querySelector(":scope > .ds-scroll-area__gutters");
          if (g) g.style.setProperty("--container-height", real);
        });
      }
    };
    window.ResizeObserver = function (cb) {
      var obs = new NativeRO(function (entries) {
        var self = this, args = arguments;
        // the message list only (the question outline is a list too, of fixed rows: sites/deepseek.js labels that one)
        var lists = entries.map(function (e) { return e.target; }).filter(function (t) { return t.classList && t.classList.contains("ds-virtual-list--printable"); });
        lists.forEach(function (el) { if (!measured.some(function (m) { return m.el === el; })) measured.push({ el: el, cb: cb, obs: obs }); });
        return withTall(lists, function () { return cb.apply(self, args); });
      });
      return obs;
    };
    window.ResizeObserver.prototype = NativeRO.prototype;
    var again = function () { // measure again where the number changed (after a scroll, new hidden keys, a need)
      measured = measured.filter(function (m) { return m.el.isConnected; });
      measured.forEach(function (m) {
        if (extraFor(m.el) === m.el._jrExtra) return;
        withTall([m.el], function () { m.cb.call(m.obs, [{ target: m.el, contentRect: m.el.getBoundingClientRect() }], m.obs); });
      });
    };
    var queued = false;
    var soon = function () { if (!queued) { queued = true; setTimeout(function () { queued = false; again(); }, 0); } };
    var mo = new MutationObserver(soon);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-jr-ds-need"] });
    var watchHead = function () { // the hide rules (#jr-hide-turns) live in <head>, which doesn't exist yet at document_start
      if (document.head) mo.observe(document.head, { childList: true, subtree: true, characterData: true });
      else setTimeout(watchHead, 50);
    };
    watchHead();
    document.addEventListener("scroll", soon, true);
  }

  // Offline tests (tools/dom-test-deepseek.html) reach the parser through this.
  window.JRDeepSeekNet = { Answer: Answer, SSE: SSE, isPopupQuestion: isPopupQuestion, citeLinks: citeLinks,
    measuring: typeof withTall === "function" ? withTall : null }; // (withTall: the list's reads inside DeepSeek's measuring)
})();

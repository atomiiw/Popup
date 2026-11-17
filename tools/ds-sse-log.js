// DeepSeek raw stream + DOM keys logger (testing only; MAIN world via tools/chrome_js.py --url chat.deepseek.com @file).
// For docs/DEEPSEEK.md browser requests B1/B2/B6: keeps the first 300 raw SSE lines of each completion request
// in window.__dsRaw, and the item keys every 250 ms while it streams in window.__dsKeys (temporary negative
// keys → real ids?). Read back: JSON.stringify({raw: window.__dsRaw, keys: window.__dsKeys})
(function () {
  if (window.__dsRawOn) return "already";
  window.__dsRawOn = true;
  window.__dsRaw = []; window.__dsKeys = [];
  var O = XMLHttpRequest.prototype.open, S = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__dsUrl = String(u); this.__dsM = String(m); return O.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (body) {
    var x = this;
    if (/\/api\/v0\/chat\/completion/.test(x.__dsUrl || "")) {
      var rec = { t: Date.now(), url: x.__dsUrl, body: String(body).slice(0, 400), lines: [] }, seen = 0;
      window.__dsRaw.push(rec);
      var keys = setInterval(function () {
        window.__dsKeys.push(Array.prototype.map.call(document.querySelectorAll("[data-virtual-list-item-key]"), function (i) { return i.getAttribute("data-virtual-list-item-key"); }).join(","));
      }, 250);
      x.addEventListener("progress", function () {
        var t = x.responseText || "", add = t.slice(seen).split("\n"); seen = t.length;
        add.forEach(function (l) { if (l.trim() && rec.lines.length < 300) rec.lines.push(l.slice(0, 300)); });
      });
      x.addEventListener("loadend", function () { clearInterval(keys); rec.done = Date.now(); });
    }
    return S.apply(this, arguments);
  };
  return "ds sse log on (XHR only; if nothing is captured, DeepSeek moved the send to fetch)";
})();

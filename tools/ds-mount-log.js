// DeepSeek: is the newest (streaming) Q&A item kept on the page while it streams if the reader is scrolled far up?
// (docs/DEEPSEEK.md B1, testing only; MAIN world via chrome_js.py --url chat.deepseek.com @file, read-only.)
// Arms on the completion request; logs every 200 ms until 5 s after it ends: mounted item keys, scrollTop, scrollHeight.
// Read back: JSON.stringify(window.__dsMount)
(function () {
  if (window.__dsMountOn) return "already";
  window.__dsMountOn = true;
  window.__dsMount = [];
  var S = XMLHttpRequest.prototype.send, O = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) { this.__dmUrl = String(u); return O.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    var x = this;
    if (/\/api\/v0\/chat\/completion/.test(x.__dmUrl || "")) {
      var run = { t0: Date.now(), rows: [], endedAt: null };
      window.__dsMount.push(run);
      var iv = setInterval(function () {
        var sc = document.querySelector(".ds-virtual-list");
        run.rows.push({ t: Date.now() - run.t0, st: sc ? Math.round(sc.scrollTop) : null, sh: sc ? sc.scrollHeight : null,
          keys: Array.prototype.map.call(document.querySelectorAll("[data-virtual-list-item-key]"), function (i) { return i.getAttribute("data-virtual-list-item-key"); }).join(",") });
        if (run.endedAt && Date.now() - run.endedAt > 5000) clearInterval(iv);
      }, 200);
      x.addEventListener("loadend", function () { run.endedAt = Date.now(); });
    }
    return S.apply(this, arguments);
  };
  return "ds mount log on";
})();

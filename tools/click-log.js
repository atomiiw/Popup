// Click / popup lifecycle log (testing only; MAIN world via chrome_js.py @file, read-only).
// Why does a secondary popup need several clicks? Records: each mousedown/click target, popups added or
// removed, a popup's answer area replaced (a rebuild), window blur/focus and focus moving to an iframe.
// Read back: JSON.stringify(window.__jrClicks)
(function () {
  if (window.__jrClicksOn) return "already";
  window.__jrClicksOn = true;
  var log = window.__jrClicks = [], t0 = performance.now();
  function t() { return Math.round(performance.now() - t0); }
  function desc(el) {
    if (!el || !el.tagName) return String(el);
    var c = typeof el.className === "string" ? el.className.split(" ").filter(function (x) { return /^jr-/.test(x); }).join(".") : "";
    return el.tagName.toLowerCase() + (c ? "." + c : "") + (el.closest && el.closest(".jr-popup") ? "@popup" + [].indexOf.call(document.querySelectorAll(".jr-popup"), el.closest(".jr-popup")) : "");
  }
  ["mousedown", "click"].forEach(function (type) {
    document.addEventListener(type, function (e) {
      log.push({ t: t(), ev: type, target: desc(e.target), text: (e.target.textContent || "").trim().slice(0, 16), popups: document.querySelectorAll(".jr-popup").length });
    }, true);
  });
  window.addEventListener("blur", function () { log.push({ t: t(), ev: "window blur", active: desc(document.activeElement) }); });
  window.addEventListener("focus", function () { log.push({ t: t(), ev: "window focus" }); });
  new MutationObserver(function (muts) {
    muts.forEach(function (m) {
      [].forEach.call(m.addedNodes, function (n) {
        if (n.nodeType !== 1) return;
        if (n.classList.contains("jr-popup")) log.push({ t: t(), ev: "popup added", popups: document.querySelectorAll(".jr-popup").length });
        if (n.classList.contains("jr-popup-response")) log.push({ t: t(), ev: "answer area (re)built", where: desc(n) });
        if (n.classList.contains("jr-render-frame")) log.push({ t: t(), ev: "render frame added" });
      });
      [].forEach.call(m.removedNodes, function (n) {
        if (n.nodeType !== 1) return;
        if (n.classList.contains("jr-popup")) log.push({ t: t(), ev: "popup removed", popups: document.querySelectorAll(".jr-popup").length });
        if (n.classList.contains("jr-render-frame")) log.push({ t: t(), ev: "render frame removed" });
      });
    });
  }).observe(document.body, { childList: true, subtree: true });
  return "click log on";
})();

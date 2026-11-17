// Popup answer: streaming vs finished (testing only; MAIN world via tools/chrome_js.py @file, read-only).
// Keeps the last snapshot of the newest popup's answer while it streams (.jr-popup--streaming) and the
// first one after it finishes, so the two can be compared: HTML, text, and the styles that make the
// "it looks different once it's done" (line height, margins, font size of the first blocks).
// Read back: JSON.stringify(window.__jrFinal)
(function () {
  if (window.__jrFinalOn) return "already";
  window.__jrFinalOn = true;
  window.__jrFinal = { streaming: null, final: null, finals: [] };
  function shot(resp) {
    var blocks = [].slice.call(resp.children).slice(0, 8).map(function (el) {
      var cs = getComputedStyle(el), r = el.getBoundingClientRect();
      return { tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 60), h: Math.round(r.height),
        lh: cs.lineHeight, fs: cs.fontSize, mt: cs.marginTop, mb: cs.marginBottom, ff: cs.fontFamily.slice(0, 30) };
    });
    return { t: Math.round(performance.now()), html: resp.innerHTML, text: (resp.textContent || "").length,
      height: Math.round(resp.scrollHeight), blocks: blocks };
  }
  var wasStreaming = false;
  setInterval(function () {
    var pops = document.querySelectorAll(".jr-popup");
    var pop = pops[pops.length - 1];
    var resp = pop && pop.querySelector(".jr-popup-response");
    if (!resp) return;
    var streaming = pop.classList.contains("jr-popup--streaming");
    if (streaming) { window.__jrFinal.streaming = shot(resp); wasStreaming = true; }
    else if (wasStreaming) { wasStreaming = false; var f = shot(resp); window.__jrFinal.final = f; window.__jrFinal.finals.push(f); }
  }, 50);
  return "final-snap on";
})();

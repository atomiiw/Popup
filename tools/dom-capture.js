// dom-capture.js — copy the DOM structure around the current selection in a ChatGPT answer,
// with every letter replaced (structure, classes, data-/aria- attributes and SVG kept).
// Use: select some text inside the component, paste this whole file into the DevTools console,
// press Enter; the result is on the clipboard. ⟦ ⟧ mark where the selection starts and ends.
(function () {
  var sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return console.warn("Select some text in the answer first.");
  var range = sel.getRangeAt(0);
  var el = function (n) { return n.nodeType === 1 ? n : n.parentElement; };
  var body = el(range.commonAncestorContainer).closest('[data-markdown-text-style="assistant-message"], [data-dil-message-id]');
  if (!body) return console.warn("The selection is not inside a ChatGPT answer.");
  // The answer's top-level blocks the selection touches
  var top = function (n) { n = el(n); while (n.parentElement !== body) n = n.parentElement; return n; };
  var first = body.contains(range.startContainer) && range.startContainer !== body ? top(range.startContainer) : body.firstElementChild;
  var last = body.contains(range.endContainer) && range.endContainer !== body ? top(range.endContainer) : body.lastElementChild;
  var KEEP = /^(class|role|id|href|lang|viewBox|d|x|y|x1|x2|y1|y2|cx|cy|r|width|height|transform|text-anchor|dominant-baseline|contenteditable|hidden|tabindex|data-.*|aria-.*)$/;
  var mask = function (s) { return s.replace(/[A-Za-z]/g, "x").replace(/[㐀-鿿가-힯぀-ヿ]/g, "字"); };
  var esc = function (s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); };
  function text(t) {
    var s = t.data, a = t === range.startContainer ? range.startOffset : -1, b = t === range.endContainer ? range.endOffset : -1;
    var out = "";
    for (var i = 0; i <= s.length; i++) {
      if (i === b) out += "⟧";
      if (i === a) out += "⟦";
      if (i < s.length) out += s[i];
    }
    return esc(mask(out));
  }
  function walk(n, depth) {
    if (n.nodeType === 3) return text(n);
    if (n.nodeType !== 1) return "";
    var tag = n.tagName.toLowerCase();
    if (tag === "script" || tag === "style") return "";
    var attrs = "";
    for (var i = 0; i < n.attributes.length; i++) {
      var at = n.attributes[i];
      if (!KEEP.test(at.name)) continue;
      var v = /^(aria-label|title|alt|href)$/.test(at.name) ? mask(at.value) : at.value;
      attrs += " " + at.name + '="' + esc(v.slice(0, 300)) + '"';
    }
    var cs = getComputedStyle(n);
    attrs += ' data-cap-display="' + cs.display + '"';
    if (cs.whiteSpace !== "normal") attrs += ' data-cap-ws="' + cs.whiteSpace + '"';
    if (cs.userSelect && cs.userSelect !== "auto") attrs += ' data-cap-us="' + cs.userSelect + '"';
    var inner = "";
    for (var c = n.firstChild; c; c = c.nextSibling) inner += walk(c, depth + 1);
    return "<" + tag + attrs + ">" + inner + "</" + tag + ">";
  }
  var parts = [], n = first;
  while (n) { parts.push(walk(n, 0)); if (n === last) break; n = n.nextElementSibling; }
  var bodyAttrs = body.getAttribute("data-markdown-text-style") ? ' data-markdown-text-style="assistant-message"' : " data-dil-message-id";
  var html = "<!-- dom-capture " + new Date().toISOString() + " " + location.pathname.replace(/[0-9a-f-]{36}/g, "<id>") +
    " | selection: " + JSON.stringify(mask(sel.toString()).slice(0, 200)) + " -->\n" +
    "<div" + bodyAttrs + ' class="' + esc(body.className) + '">' + parts.join("\n") + "</div>";
  copy(html);
  console.log("Copied " + html.length + " characters (" + parts.length + " block(s)). Paste it back to Claude.");
})();

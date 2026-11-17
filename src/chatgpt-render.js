// chatgpt-render.js — ChatGPT draws a Popup answer itself (R34).
//
// Popup's Q&A turns are hidden in the page (and filtered out of its data after a reload), so ChatGPT
// renders them only by chance (while it streams, near the bottom). For everything else Popup used to
// redraw the Markdown itself and chase ChatGPT's format changes. Instead: a hidden same-origin iframe
// of the same conversation (Popup doesn't run in frames, so there nothing is filtered or hidden),
// scrolled — invisibly — to the turn; ChatGPT renders it there and Popup copies the result.
// Nothing is stored: one frame per conversation, kept while requests come, dropped after 60 s idle.
(function () {
  "use strict";

  var frame = null, frameConv = null, idleTimer = null;
  var frameId = 0, styledId = 0; // each frame load gets an id: its generated CodeMirror class names belong to it
  var queue = Promise.resolve();

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /** Poll fn() every ms until it returns something truthy, or give up after tries. */
  function until(fn, ms, tries) {
    return new Promise(function (resolve) {
      (function poll(n) {
        var v; try { v = fn(); } catch (e) { v = null; }
        if (v || n <= 0) return resolve(v || null);
        setTimeout(function () { poll(n - 1); }, ms);
      })(tries);
    });
  }

  function dropFrame() {
    if (frame) frame.remove();
    frame = null; frameConv = null;
  }

  function frameFor(conv) {
    if (frame && frameConv === conv && frame.isConnected) return frame;
    dropFrame();
    frame = document.createElement("iframe");
    frame.className = "jr-render-frame"; // off screen, laid out at a popup's width (styles.css)
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.src = "/c/" + conv;
    frameConv = conv;
    frameId++;
    document.body.appendChild(frame);
    return frame;
  }

  function doc() {
    try { return frame && frame.contentDocument; } catch (e) { return null; }
  }

  /** The turn in the frame: ChatGPT's list mounts only turns near the scroll position, so look from the bottom up. */
  function findTurn(key) {
    var d = doc(), sc = d && JR.site.frameScroller(d);
    if (!sc) return Promise.resolve(null);
    var top = sc.scrollHeight;
    return (function step(n) {
      var t = JR.site.frameTurn(d, key);
      if (t || n <= 0 || top < 0) return Promise.resolve(t || null);
      sc.scrollTop = top;
      top -= sc.clientHeight * 0.8;
      return wait(250).then(function () { return step(n - 1); });
    })(80);
  }

  /** The answer once ChatGPT has finished drawing it (same text twice in a row). */
  function renderedHTML(turn) {
    var last = -1;
    return until(function () {
      if (!turn.isConnected) return null;
      var len = JR.site.assistantText(turn).trim().length;
      var done = len > 0 && len === last;
      last = len;
      return done ? JR.site.assistantHTML(turn) : null;
    }, 300, 34);
  }

  function render(key) {
    var conv = JR.site.conversationId();
    if (!conv || !key) return Promise.resolve(null);
    frameFor(conv);
    return until(function () { var d = doc(); return d && JR.site.frameScroller(d) && JR.site.frameTurnCount(d); }, 300, 100)
      .then(function (ready) { return ready ? findTurn(key) : null; })
      .then(function (turn) { return turn ? renderedHTML(turn) : null; })
      .then(function (html) {
        if (!html) return null;
        copyFrameStyles();
        return '<div class="jr-frame-answer" data-jr-frame="' + frameId + '">' + html + "</div>";
      });
  }

  /**
   * CSS text applying ruleTexts only inside answers taken from frame load `id` (CSS nesting: each rule
   * becomes a descendant of the scope). CodeMirror generates its class names (ͼ1, ͼ2…) per document at
   * run time, so the frame's rules can't be copied as they are: in the page the same names may mean
   * something else (R36g: copied code blocks lost their indentation and line height).
   */
  JR.scopeFrameRules = function (ruleTexts, id) {
    return ruleTexts.length ? '.jr-frame-answer[data-jr-frame="' + id + '"] {\n' + ruleTexts.join("\n") + "\n}" : "";
  };

  /** Bring the frame's generated (ͼ) rules into the page, scoped to this frame load's answers. Once per load. */
  function copyFrameStyles() {
    if (styledId === frameId) return;
    var d = doc();
    if (!d) return;
    var texts = [];
    [].slice.call(d.styleSheets).concat([].slice.call(d.adoptedStyleSheets || [])).forEach(function (ss) {
      var rules;
      try { rules = ss.cssRules; } catch (e) { return; } // cross-origin sheet
      [].forEach.call(rules, function (r) {
        if ((r.type === 1 || r.type === 4) && r.cssText.indexOf(".\u037C") !== -1) texts.push(r.cssText); // style / @media rules with ͼ classes
      });
    });
    var el = document.createElement("style");
    el.setAttribute("data-jr-frame-styles", String(frameId));
    el.textContent = JR.scopeFrameRules(texts, frameId);
    (document.head || document.documentElement).appendChild(el);
    styledId = frameId;
  }

  /** ChatGPT's own rendering of the answer in the turn with this key (string), or null. One at a time. */
  JR.chatgptRender = function (key) {
    var p = queue.then(function () { return render(key); }).catch(function () { return null; });
    queue = p.then(function () {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(dropFrame, 60000);
    });
    return p;
  };

  // Another conversation: this frame's answers are no use any more.
  window.addEventListener("popstate", dropFrame);
})();

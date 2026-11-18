// site-render.js — The site draws a Popup answer itself (R34; ChatGPT and claude.ai — DeepSeek forbids framing).
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
    frame.src = JR.site.chatUrl(conv);
    frameConv = conv;
    frameId++;
    document.body.appendChild(frame);
    return frame;
  }

  function doc() {
    try { return frame && frame.contentDocument; } catch (e) { return null; }
  }

  /** The keys of the turns the frame has mounted now. */
  function mountedKeys(d) {
    return Array.prototype.map.call(d.querySelectorAll(JR.SEL.turn), function (t) { return JR.site.turnKey(t); }).filter(Boolean);
  }

  /**
   * The turn in the frame. ChatGPT mounts only turns near the scroll position and, in a long chat, loads the earlier
   * ones only when scrolled to the top (live 2026-11-18: the turn was never reached and the popup kept Popup's
   * drawing). With the conversation's turn order: jump to its estimated place, then step toward it; at the top, wait
   * for earlier turns to load. Without an order (claude.ai): from the bottom up.
   */
  function findTurn(key) {
    var d = doc(), sc = d && JR.site.frameScroller(d);
    if (!sc) return Promise.resolve(null);
    var order = JR.qa.turnOrderCache || [], target = order.indexOf(key), atTop = 0;
    if (target >= 0) sc.scrollTop = sc.scrollHeight * target / order.length - sc.clientHeight / 2;
    else sc.scrollTop = sc.scrollHeight;
    return (function step(n) {
      var t = JR.site.frameTurn(d, key);
      if (t || n <= 0) return Promise.resolve(t || null);
      var at = mountedKeys(d).map(function (k) { return order.indexOf(k); }).filter(function (i) { return i >= 0; });
      var down = target >= 0 && at.length && Math.max.apply(null, at) < target;
      if (!down && sc.scrollTop <= 0) {
        if (++atTop > 20) return Promise.resolve(null); // ~5 s at the top and nothing earlier came
      } else atTop = 0;
      sc.scrollTop += (down ? 1 : -1) * sc.clientHeight * 0.8;
      return wait(250).then(function () { return step(n - 1); });
    })(160);
  }

  /** Scroll the frame to the top until the whole conversation is loaded (no growth for 2 s, or 30 s), so a later
   *  findTurn doesn't wait for earlier turns. */
  function loadAll() {
    var d = doc(), sc = d && JR.site.frameScroller(d);
    if (!sc) return Promise.resolve();
    var last = -1, same = 0;
    return (function step(n) {
      sc.scrollTop = 0;
      if (sc.scrollHeight === last) same++; else { same = 0; last = sc.scrollHeight; }
      if (same >= 8 || n <= 0) return Promise.resolve();
      return wait(250).then(function () { return step(n - 1); });
    })(120);
  }

  /** Bring each code block of the turn into the frame's visible top part in turn (claude.ai colours code only when
   *  it is on screen; the frame is in the viewport, unseen, but a long answer's lower blocks were below it). */
  function revealCode(turn) {
    var blocks = Array.prototype.slice.call(turn.querySelectorAll("pre"));
    return blocks.reduce(function (p, pre) {
      return p.then(function () { pre.scrollIntoView({ block: "start" }); return wait(250); });
    }, Promise.resolve());
  }

  /** The answer once the site has finished drawing it (same text twice in a row), with its question's text. */
  function rendered(turn) {
    var last = -1, polls = 0;
    // code is coloured later than the text (claude.ai: on screen only, and after loading the language's colours):
    // wait for coloured tokens in every block, ~5 s at most
    function codeColoured() {
      if (JR.site.name !== "claude") return true; // (ChatGPT's code is drawn with its text; its answers are held ≤ 5 s)
      return Array.prototype.every.call(turn.querySelectorAll("pre"), JR.site.codeColoured);
    }
    return until(function () {
      if (!turn.isConnected) return null;
      if (++polls < 17 && !codeColoured()) return null;
      // the whole drawing holds still (code is coloured a moment after the text is in), not only the text
      var len = JR.site.assistantText(turn).trim() ? JR.site.assistantHTML(turn).length : 0;
      var done = len > 0 && len === last;
      last = len;
      return done ? { html: JR.site.assistantHTML(turn), question: JR.site.userText(turn) } : null;
    }, 300, 34);
  }

  function render(key) {
    var conv = JR.site.conversationId();
    if (!conv || !key) return Promise.resolve(null);
    frameFor(conv);
    return frameReady()
      .then(function (ready) { return ready && JR.qa.turnOrder ? JR.qa.turnOrder().then(function () { return ready; }) : ready; })
      .then(function (ready) { return ready ? findTurn(key) : null; })
      .then(function (turn) { return turn ? revealCode(turn).then(function () { return rendered(turn); }) : null; })
      .then(function (r) {
        if (!r || !r.html) return null;
        copyFrameStyles();
        return { html: '<div class="jr-frame-answer" data-jr-frame="' + frameId + '">' + r.html + "</div>", question: r.question };
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

  function frameReady() {
    return until(function () { var d = doc(); return d && JR.site.frameScroller(d) && JR.site.frameTurnCount(d); }, 300, 100);
  }

  /** The site's own rendering of the answer in the turn with this key ({ html, question }), or null. One at a time. */
  JR.siteRender = function (key) {
    var p = queue.then(function () { return render(key); }).catch(function () { return null; });
    queue = p.then(function () {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(dropFrame, 180000);
    });
    return p;
  };

  /** Load the frame ahead (after a reload, when this conversation has Popup answers) with the whole conversation,
   *  so opening one is quick. Queued like a render: they share the frame's scrolling. */
  JR.siteRenderPrewarm = function () {
    var conv = JR.site.conversationId();
    if (!conv) return;
    frameFor(conv);
    queue = queue.then(function () { return frameReady().then(function (ready) { return ready ? loadAll() : null; }); }).catch(function () {});
    clearTimeout(idleTimer);
    idleTimer = setTimeout(dropFrame, 180000);
  };

  // Another conversation: this frame's answers are no use any more.
  window.addEventListener("popstate", dropFrame);
})();

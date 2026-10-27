// dom-probe.js — read-only probe of chatgpt.com's DOM for the Popup fix.
// Run in DevTools console (or via a browser tool) on an EXISTING conversation page
// (https://chatgpt.com/c/...) with at least one user + one assistant message.
// It sends nothing and changes nothing. Result: a JSON string (also copied to clipboard if possible).
(() => {
  const attrs = (el) => el ? Object.fromEntries([...el.attributes].map(a => [a.name, a.value.slice(0, 80)])) : null;
  const short = (el) => el ? {
    tag: el.tagName.toLowerCase(),
    id: el.id || undefined,
    cls: (typeof el.className === "string" ? el.className : "").slice(0, 80) || undefined,
    data: Object.fromEntries([...el.attributes].filter(a => a.name.startsWith("data-") || a.name === "role" || a.name.startsWith("aria-")).map(a => [a.name, a.value.slice(0, 60)])),
  } : null;
  const chain = (el, stop) => { const out = []; while (el && el !== stop && el !== document.body) { out.push(short(el)); el = el.parentElement; } return out; };
  const count = (s) => { try { return document.querySelectorAll(s).length; } catch (e) { return "ERR"; } };

  const msgs = [...document.querySelectorAll("[data-message-role], [data-message-author-role]")];
  const user = msgs.find(m => (m.dataset.messageRole || m.dataset.messageAuthorRole) === "user");
  const asst = msgs.find(m => (m.dataset.messageRole || m.dataset.messageAuthorRole) === "assistant");
  const md = asst && (asst.querySelector("[data-assistant-markdown]") || asst.querySelector(".markdown"));
  const composerCandidates = [...document.querySelectorAll('[contenteditable="true"], textarea')].map(e => ({ ...short(e), chain: chain(e.parentElement).slice(0, 4) }));
  const form = document.querySelector("form");
  const buttons = [...document.querySelectorAll("button")].filter(b => b.closest("form") || /send|stop|submit/i.test((b.getAttribute("aria-label") || "") + Object.keys(b.dataset).join(" ")))
    .map(b => ({ ...short(b), text: b.textContent.trim().slice(0, 30), disabled: b.disabled }));
  const entities = asst ? [...asst.querySelectorAll("[data-content-reference-type], [data-assistant-entity-trigger], [data-assistant-entity-reference], span.cursor-pointer, a")].slice(0, 5).map(e => ({ ...short(e), text: e.textContent.trim().slice(0, 30) })) : [];
  const scrollers = [...document.querySelectorAll("*")].filter(e => { const s = getComputedStyle(e); return /auto|scroll/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 10; }).slice(0, 6).map(e => ({ ...short(e), sh: e.scrollHeight, ch: e.clientHeight, w: e.clientWidth }));

  const out = {
    url: location.href, when: new Date().toISOString(), lang: document.documentElement.lang, w: innerWidth,
    htmlAttrs: attrs(document.documentElement),
    counts: {
      "data-message-role": count("[data-message-role]"), "data-message-author-role": count("[data-message-author-role]"),
      "data-turn": count("[data-turn]"), "conversation-turn testid": count('[data-testid^="conversation-turn-"]'), article: count("article"),
      "data-assistant-markdown": count("[data-assistant-markdown]"), ".markdown": count(".markdown"),
      "data-message-streaming": count("[data-message-streaming]"), "data-message-complete": count("[data-message-complete]"),
      "#prompt-textarea": count("#prompt-textarea"), ".ProseMirror": count(".ProseMirror"), "data-octane-lexical-composer": count("[data-octane-lexical-composer]"),
      "data-lexical-editor": count("[data-lexical-editor]"), "data-composer-submit": count("[data-composer-submit]"), "data-stop-generating": count("[data-stop-generating]"),
      "send-button testid": count('[data-testid="send-button"]'), "stop-button testid": count('[data-testid="stop-button"]'),
      "react-scroll-to-bottom": count('[class*="react-scroll-to-bottom"]'), "data-thread-bottom-anchor": count("[data-thread-bottom-anchor]"),
      "data-scroll-to-bottom": count("[data-scroll-to-bottom]"), main: count("main"), nav: count("nav"), "[popover]": count("[popover]"),
    },
    userMsg: user ? { el: attrs(user), chain: chain(user) } : null,
    assistantMsg: asst ? { el: attrs(asst), chain: chain(asst), childTags: [...asst.children].map(short) } : null,
    markdown: md ? { el: short(md), firstChildren: [...md.children].slice(0, 4).map(short) } : null,
    msgOrder: msgs.slice(0, 8).map(m => ({ role: m.dataset.messageRole || m.dataset.messageAuthorRole, id: m.id || m.dataset.messageId, data: short(m).data })),
    composer: composerCandidates, form: form ? short(form) : null, buttons, entities, scrollers,
  };
  const json = JSON.stringify(out, null, 1);
  try { copy(json); } catch (e) { /* not in DevTools */ }
  return json;
})();

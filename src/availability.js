// availability.js — Where each version's answer stands for the popup right now (GLOSSARY.md: availability). The one
// owner of it: the send's watch, the locator and the popup only send events; every wait names what it waits for and
// until when, and a deadline passing moves it on — "Loading…" can't stand with nothing behind it
// (docs/DESIGN-availability.md). Memory only: the stored answer state (pending / failed / done) is unchanged.
(function () {
  "use strict";

  /** Every limit in one place (design decision 3). streaming: the send's watch ends it first (its own idle and
   *  generating limits, chat.js — they read these); this is the backstop. */
  var LIMITS = { sending: 10000, streamingIdle: 100000, streamingGenerating: 600000, locating: 30000, hint: 3000 };

  var WAITS = { sending: true, streaming: true, locating: true };
  /** Reasons looking again can't help with (Ask again, not Try again): no Q&A linked in the chat; not on the branch shown. */
  var FINAL = { "no-qa": true, branch: true };

  /**
   * The pure step: (state, event, now) → state. Kinds: idle, sending, streaming, done, locating, shown, failed,
   * unreachable. Events (ev.t): send, sent, waiting{what}, done, locate, found{via}, missing{why, final}, lost,
   * failed{reason}, tick, reset.
   */
  function step(s, ev, now) {
    s = s || { kind: "idle" };
    function waitFor(kind, what, limit, extra) {
      return Object.assign({ kind: kind, waitingFor: what, since: now, deadline: now + limit }, extra || {});
    }
    switch (ev.t) {
      case "send": return waitFor("sending", "send", LIMITS.sending);
      case "sent": return waitFor("streaming", "answer", LIMITS.streamingGenerating + LIMITS.streamingIdle);
      case "done": return { kind: "done" };
      case "locate":
        // (asked again while it is being located: the deadline counts from the first ask — decision 2/Q2)
        if (s.kind === "locating" && !ev.again) return s;
        return waitFor("locating", ev.what || "page", LIMITS.locating, { lastWhy: null });
      case "waiting":
        return WAITS[s.kind] && s.waitingFor !== ev.what ? Object.assign({}, s, { waitingFor: ev.what }) : s;
      case "found":
        return s.kind === "shown" && s.via === ev.via ? s : { kind: "shown", via: ev.via || "page" };
      case "missing":
        if (s.kind !== "locating") return s;
        if (ev.final) return { kind: "unreachable", reason: ev.why, ask: true };
        return s.lastWhy === ev.why ? s : Object.assign({}, s, { lastWhy: ev.why });
      case "lost": return s.kind === "shown" ? waitFor("locating", "page", LIMITS.locating, { lastWhy: null }) : s;
      case "failed": return { kind: "failed", reason: ev.reason || "no-answer" };
      case "tick":
        if (!WAITS[s.kind] || !(now >= s.deadline)) return s;
        if (s.kind === "locating") return { kind: "unreachable", reason: s.lastWhy || "not-found", ask: !!FINAL[s.lastWhy] };
        return { kind: "failed", reason: s.kind === "sending" ? "not-sent" : "no-answer" };
      case "reset": return { kind: "idle" };
    }
    return s;
  }

  var states = new Map(), watchers = new Map(), timer = null;

  function notify(id, state) {
    (watchers.get(id) || []).slice().forEach(function (fn) { try { fn(state); } catch (e) { console.warn("[Popup] availability watcher:", e); } });
  }
  function tickAll() {
    var now = Date.now(), any = false;
    states.forEach(function (s, id) {
      if (WAITS[s.kind]) { any = true; on(id, { t: "tick" }, now); }
    });
    if (!any && timer) { clearInterval(timer); timer = null; }
  }
  function on(id, ev, now) {
    if (!id) return null;
    var old = states.get(id), s = step(old, ev, now || Date.now());
    if (s === old) return s;
    states.set(id, s);
    if (WAITS[s.kind] && !timer) timer = setInterval(tickAll, 1000);
    notify(id, s);
    return s;
  }

  JR.availability = {
    LIMITS: LIMITS,
    step: step,
    /** Send an event about version id; returns its availability after it. */
    on: function (id, ev) { return on(id, ev); },
    /** Its availability now ({ kind: "idle" } when nothing is known). */
    of: function (id) { return states.get(id) || { kind: "idle" }; },
    /** fn(state) on every change of version id's availability; returns the function that stops it. */
    watch: function (id, fn) {
      var list = watchers.get(id) || [];
      list.push(fn);
      watchers.set(id, list);
      return function () { var l = watchers.get(id) || []; var i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
    },
    /** Another chat: nothing carries over. */
    clear: function () { states.clear(); watchers.clear(); if (timer) { clearInterval(timer); timer = null; } },
    /** For JR.diagnose: the versions waiting now, and for what. */
    waiting: function () {
      var out = [];
      states.forEach(function (s, id) { if (WAITS[s.kind] || s.kind === "unreachable") out.push({ id: String(id).slice(0, 8), kind: s.kind, waitingFor: s.waitingFor || null, why: s.lastWhy || s.reason || null, left: s.deadline ? Math.round((s.deadline - Date.now()) / 1000) : null }); });
      return out;
    },
  };
})();

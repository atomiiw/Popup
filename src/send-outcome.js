// send-outcome.js — A send's outcome, decided in one place (overnight plan A1, docs/DESIGN-send-outcome.md): from what is
// known about it now — the site's stream (net-tap.js, deepseek-net.js), the page (its new turns, the input box), the
// clock — what to do next: wait, take the answer, read it from the conversation, send again, or fail with a named
// reason. Pure: chat.js gathers the facts each poll and carries the decision out (hide, store, the popup).
(function () {
  "use strict";

  var LIMITS = {
    refusal: 1500,      // the site put our message back in its box (busy): looked for after this
    quick: 3000,        // nothing of ours and the site idle
    notFound: 4000,     // the site answering, our turn nowhere: noted for the reason
    hard: 10000,        // no answer and the site not working on one
    resumeWait: 1500,   // a stream that ended with a resume token: the conversation read after this, …
    resumeLooks: 6,     // … up to this many times
    stale: 60000,       // the site says generating, the answer unchanged this long: taken as it is
    idle: 100000,       // nothing new, the site idle
    generating: 600000, // nothing new, the site generating
  };

  /**
   * f: { now, start, lastProgress, generating, keys (our turns known), responseKey (our answer's turn known),
   *      turn: null | { text, answered } (our answer's turn on the page: has text; has an answer — text or an image),
   *      domUsable (the page's answer can be read), submitting, composerHasOurs (our message back in the site's box),
   *      canResend (no files: a resend would drop them), rejected: { count, pending },
   *      net: { matched, done, text, media, resuming (time or 0) }, resume: { n, busy } }
   * → { act: "wait" | "capture" | "resend" | "fail" | "stop-fail", stage?, readResume?, report? }
   *   stage: a failure's stage (failureText); readResume: read the answer from the conversation now (and go on);
   *   report: a stage to note for a later failure's reason.
   */
  function decide(f) {
    var L = LIMITS, el = f.now - f.start, net = f.net, turn = f.turn;
    // done: the site stopped and the answer is on the page
    if (turn && !f.generating && (turn.text || turn.answered)) return { act: "capture" }; // (an image alone: answered)
    // done per the stream, the page's answer not readable (not mounted, the site's "couldn't load")
    if (net.done && (net.text || net.media) && !f.domUsable) return { act: "capture" };
    // done while our answer is scrolled out of the page (keys known; its content comes from its original)
    if (f.responseKey && !turn && !f.generating && !net.matched) return { act: "capture" };
    // the site says generating but the answer stopped changing (not while the stream is open: it may be searching)
    if (turn && f.generating && !(net.matched && !net.done) && turn.text && f.now - f.lastProgress >= L.stale) return { act: "capture" };
    // the site refused it (busy) and put it back in its box: sent again once when idle — not with files
    if (!f.keys && !net.matched && !f.rejected.pending && !f.submitting && el >= L.refusal && f.composerHasOurs) {
      if (f.rejected.count >= 1 || !f.canResend) return { act: "fail", stage: "rejected" };
      return { act: "resend" };
    }
    if (f.rejected.pending) return { act: "wait" };
    if (!f.keys && !net.matched && !f.generating && el >= L.quick) return { act: "fail", stage: "no-answer" };
    var out = { act: "wait" };
    if (!f.keys && !net.matched && f.generating && el >= L.notFound) out.report = "turn-not-found";
    // the stream ended before the answer (a thinking model resumes elsewhere): once the site is done, the conversation
    if (net.resuming && !net.done && !f.generating && !f.resume.busy && f.resume.n < L.resumeLooks && f.now - net.resuming >= L.resumeWait) out.readResume = true;
    var hasAnswer = (turn && (turn.text || turn.answered)) || net.text || net.media;
    if (el >= L.hard && !hasAnswer && !f.generating && !(net.matched && !net.done)) return { act: "fail", stage: "no-answer" };
    if (f.now - Math.max(f.start, f.lastProgress) >= (f.generating ? L.generating : L.idle)) return { act: "stop-fail", stage: "no-answer" };
    return out;
  }

  /**
   * At capture: done, or failed as empty (the user stopped it, an error). An answer that is only an image (ChatGPT) is
   * one — its turn has no text and the stream none either (review A1: it was stored failed).
   * f: { answerText, turn: null | { answered }, net: { text, media } } → "done" | "empty"
   */
  function settle(f) {
    if (!f.answerText && f.turn && !f.net.text && !f.net.media && !f.turn.answered) return "empty";
    return "done";
  }

  JR.sendOutcome = { LIMITS: LIMITS, decide: decide, settle: settle };
})();

// send-outcome-test.js — a send's outcome (src/send-outcome.js) replayed on the cases that went wrong live: each a list of
// what was known at each poll; the decisions must come out as named. Usage: node tools/send-outcome-test.js /path/to/Popup
const fs = require("fs"), vm = require("vm"), path = require("path");
const ctx = vm.createContext({ JR: {}, console });
vm.runInContext(fs.readFileSync(path.join(process.argv[2] || ".", "src/send-outcome.js"), "utf8"), ctx);
const O = ctx.JR.sendOutcome, L = O.LIMITS;
let failed = 0;
function check(name, ok, got) { if (!ok) failed++; console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  got " + JSON.stringify(got))); }

/** What is known at time t, from a base (nothing yet) and changes. */
function facts(t, ch) {
  const f = { now: t, start: 0, lastProgress: 0, generating: false, keys: 0, responseKey: false, turn: null, domUsable: false,
    submitting: false, composerHasOurs: false, canResend: true, rejected: { count: 0, pending: false },
    net: { matched: false, done: false, text: "", media: false, resuming: 0 }, resume: { n: 0, busy: false } };
  Object.keys(ch || {}).forEach((k) => { f[k] = k === "net" ? Object.assign(f.net, ch.net) : ch[k]; });
  return f;
}
/** The first decision that isn't "wait" over the polls, or the last one. */
function run(polls) { let d; for (const [t, ch] of polls) { d = O.decide(facts(t, ch)); if (d.act !== "wait" || d.readResume) return Object.assign({ t }, d); } return d; }

// a plain send: turn, text, the site stops → taken
let d = run([[80, { generating: true }], [500, { generating: true, keys: 1, net: { matched: true } }],
  [3000, { generating: false, keys: 1, responseKey: true, turn: { text: true, answered: true }, net: { matched: true, done: true, text: "x" } }]]);
check("a plain send: taken when the site stops with the answer on the page", d.act === "capture" && d.t === 3000, d);

// thinking model (live 11-20): the stream ends with a resume token, nothing on the page, the site idle → the conversation
// read (not failed at 3 s / 10 s while it resumes); found → taken
d = run([[100, { generating: true, keys: 1, net: { matched: true } }],
  [5000, { generating: false, keys: 1, net: { matched: true, resuming: 3000 } }]]);
check("thinking model's resume token: the answer read from the conversation", d.readResume === true && d.act === "wait", d);
d = O.decide(facts(5000, { keys: 1, net: { matched: true, done: true, media: false, text: "answer", resuming: 4000 } }));
check("…found there: taken", d.act === "capture", d);

// image-only answer (ChatGPT): the stream done with media, no text anywhere → taken, and settled done (it was failed)
d = O.decide(facts(9000, { keys: 1, responseKey: true, net: { matched: true, done: true, media: true } }));
check("an image only: taken", d.act === "capture", d);
check("an image only: done, not empty", O.settle({ answerText: "", turn: { answered: true }, net: { text: "", media: false } }) === "done"
  && O.settle({ answerText: "", turn: null, net: { text: "", media: true } }) === "done", "");
check("an image alone on the page, the stream not matched: taken (not failed at 10 s)",
  O.decide(facts(L.hard, { keys: 1, responseKey: true, turn: { text: false, answered: true } })).act === "capture", "");
check("nothing at all: empty (failed)", O.settle({ answerText: "", turn: { answered: false }, net: { text: "", media: false } }) === "empty", "");

// the site refused it (busy) and put it back: sent again once; refused again → failed as rejected (its own reason)
d = O.decide(facts(1600, { generating: true, composerHasOurs: true }));
check("refused once: sent again", d.act === "resend", d);
d = O.decide(facts(1600, { generating: true, composerHasOurs: true, rejected: { count: 1, pending: false } }));
check("refused twice: failed as rejected (not 'Couldn't get a response')", d.act === "fail" && d.stage === "rejected", d);
d = O.decide(facts(1600, { composerHasOurs: true, canResend: false }));
check("refused with files: failed as rejected (a resend would drop them)", d.act === "fail" && d.stage === "rejected", d);

// nothing of ours and the site idle: failed at 3 s, not before
check("nothing, site idle: waits before 3 s", O.decide(facts(L.quick - 1)).act === "wait", "");
check("nothing, site idle: failed at 3 s", O.decide(facts(L.quick)).act === "fail", "");
// the site answering, our turn nowhere: noted at 4 s, not failed
d = O.decide(facts(L.notFound, { generating: true }));
check("site answering, our turn not found: noted for the reason, still waiting", d.act === "wait" && d.report === "turn-not-found", d);
// a long answer that keeps growing: never failed while it grows; stuck → stopped and failed at its limit
check("generating with progress: waits", O.decide(facts(500000, { generating: true, keys: 1, net: { matched: true }, lastProgress: 499000 })).act === "wait", "");
d = O.decide(facts(L.generating + 10, { generating: true, keys: 1, net: { matched: true } }));
check("generating, nothing new for its limit: stopped and failed", d.act === "stop-fail", d);
// the site says generating but the answer stopped changing: taken (stale), not while the stream is open
check("stale on the page: taken", O.decide(facts(L.stale + 10, { generating: true, keys: 1, turn: { text: true }, net: { matched: false } })).act === "capture", "");
check("stale but the stream still open: waits", O.decide(facts(L.stale + 10, { generating: true, keys: 1, turn: { text: true }, net: { matched: true } })).act === "wait", "");

console.log(failed ? failed + " FAILED" : "all passed");
process.exit(failed ? 1 : 0);

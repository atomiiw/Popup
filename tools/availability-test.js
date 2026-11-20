// availability-test.js — the availability step (src/availability.js) replayed on today's cases: every wait ends in a
// named state before its deadline (docs/DESIGN-availability.md). Usage: node tools/availability-test.js /path/to/Popup
const fs = require("fs"), vm = require("vm"), path = require("path");
const ctx = vm.createContext({ JR: {}, console, setInterval, clearInterval, Date });
vm.runInContext(fs.readFileSync(path.join(process.argv[2] || ".", "src/availability.js"), "utf8"), ctx);
const A = ctx.JR.availability, L = A.LIMITS;
let failed = 0;
function check(name, ok, got) { if (!ok) failed++; console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  got " + JSON.stringify(got))); }
function run(events) { let s; events.forEach(([t, ev]) => { s = A.step(s, ev, t); }); return s; }

// a send → its answer streams → done → a popup shows it → found on the page
let s = run([[0, { t: "send" }], [500, { t: "sent" }], [9000, { t: "done" }], [9100, { t: "locate" }], [9150, { t: "found", via: "page" }]]);
check("a send to shown: sending, streaming, done, locating, shown on the page", s.kind === "shown" && s.via === "page", s);

// the hidden copy stuck (live 11-20): never found — at the deadline unreachable, with the last reason, Try again
s = run([[0, { t: "locate" }], [500, { t: "waiting", what: "frame" }], [4000, { t: "missing", why: "frame-stuck" }], [L.locating - 1, { t: "tick" }]]);
check("stuck copy: still locating just before the deadline, waiting for the copy", s.kind === "locating" && s.waitingFor === "frame", s);
s = A.step(s, { t: "tick" }, L.locating);
check("stuck copy: unreachable at the deadline, its reason kept, looking again offered (not a resend)", s.kind === "unreachable" && s.reason === "frame-stuck" && s.ask === false, s);

// an old item with no Q&A linked in the chat: unreachable at once, Ask again (looking again can't help)
s = run([[0, { t: "locate", what: "data" }], [10, { t: "missing", why: "no-qa", final: true }]]);
check("no Q&A linked: unreachable at once, Ask again", s.kind === "unreachable" && s.reason === "no-qa" && s.ask === true, s);

// a thinking model's stream ended with only a resume token (live 11-20): no done event — streaming ends at its limit
s = run([[0, { t: "send" }], [300, { t: "sent" }], [2000, { t: "waiting", what: "data" }], [300 + L.streamingGenerating + L.streamingIdle, { t: "tick" }]]);
check("a stream that never says done: failed at the backstop, not Loading for good", s.kind === "failed" && s.reason === "no-answer", s);

// a send that never left the box: failed after the sending limit, as not sent
s = run([[0, { t: "send" }], [L.sending, { t: "tick" }]]);
check("never sent: failed (not sent) after its limit", s.kind === "failed" && s.reason === "not-sent", s);

// a queued search: the deadline counts from the ask, the queue's wait included
s = run([[0, { t: "locate" }], [100, { t: "waiting", what: "queue" }], [20000, { t: "locate" }], [L.locating, { t: "tick" }]]);
check("queued: asked again meanwhile doesn't restart the deadline; unreachable at ask + limit", s.kind === "unreachable", s);

// Try again: a new deadline
s = run([[0, { t: "locate" }], [L.locating, { t: "tick" }], [L.locating + 5000, { t: "locate", again: true }], [L.locating + 6000, { t: "tick" }]]);
check("Try again: locating again with a deadline of its own", s.kind === "locating" && s.deadline === L.locating + 5000 + L.locating, s);

// shown, then its original dropped by the page: locating again (bounded too)
s = run([[0, { t: "locate" }], [10, { t: "found", via: "frame" }], [5000, { t: "lost" }]]);
check("shown, original lost: locating again with a deadline", s.kind === "locating" && s.deadline === 5000 + L.locating, s);

// ponytail review: a final reason from before its Q&A was linked doesn't end it as "not in the chat"
s = run([[0, { t: "locate", what: "data" }], [10, { t: "missing", why: "no-qa" }], [2000, { t: "locate" }], [L.locating, { t: "tick" }]]);
check("linked meanwhile: the old no-Q&A reason is dropped — unreachable as not found, Try again (no resend)", s.kind === "unreachable" && s.reason === "not-found" && s.ask === false, s);
// ...a long answer's deadline moves on as it grows; a send with files gets the upload's time
s = run([[0, { t: "send" }], [100, { t: "sent" }], [650000, { t: "progress" }], [760000, { t: "tick" }]]);
check("streaming that keeps growing: not failed at the first deadline", s.kind === "streaming", s);
s = run([[0, { t: "send", files: true }], [L.sending + 1000, { t: "tick" }]]);
check("a send with files: still sending past 10 s (their upload)", s.kind === "sending" && s.waitingFor === "files", s);
// ...a done version taking over a follow whose original went: locating (with a deadline), not left as done
s = run([[0, { t: "done" }], [10, { t: "lost" }]]);
check("done, its original lost: locating with a deadline", s.kind === "locating" && s.deadline === 10 + L.locating, s);

// the store: watchers hear every change, ticks move a past deadline on
const seen = [];
A.watch("v1", (st) => seen.push(st.kind));
A.on("v1", { t: "locate" });
A.on("v1", { t: "found", via: "page" });
A.on("v1", { t: "found", via: "page" }); // (no change: not told again)
check("store: a watcher is told each change once", seen.join() === "locating,shown", seen);
A.clear();

console.log(failed ? failed + " FAILED" : "all passed");
process.exit(failed ? 1 : 0);

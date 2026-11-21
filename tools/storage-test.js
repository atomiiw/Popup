// storage-test.js — storage.js in two "tabs" (two contexts) over one fake chrome.storage.local:
// a tab keeps its cached conversation after its own write, drops it after another tab's, and a rebuilt
// highlight another tab stored meanwhile isn't stored twice.
// Usage: node tools/storage-test.js /path/to/Popup
const fs = require("fs"), vm = require("vm"), path = require("path");
const src = fs.readFileSync(path.join(process.argv[2] || ".", "storage.js"), "utf8");
const data = {}, listeners = [];
let gets = 0;
const local = {
  get: async (k) => { gets++; const o = {}; (Array.isArray(k) ? k : [k]).forEach((x) => { if (x in data) o[x] = structuredClone(data[x]); }); return o; },
  set: async (o) => {
    const changes = {};
    Object.keys(o).forEach((k) => { data[k] = structuredClone(o[k]); changes[k] = { newValue: structuredClone(o[k]) }; });
    setTimeout(() => listeners.forEach((l) => l(changes, "local")), 0); // (Chrome tells every tab, this one too, later)
  },
  remove: async () => {},
};
function tab() {
  const ctx = vm.createContext({
    chrome: { runtime: { id: "x" }, storage: { local, onChanged: { addListener: (l) => listeners.push(l) } } },
    JR_HOST: { convKey: (u) => "popup:conv:" + u }, crypto, console, performance, setTimeout, structuredClone,
  });
  vm.runInContext(src, ctx);
  return ctx;
}
const tick = () => new Promise((r) => setTimeout(r, 5));
let failed = 0;
function check(name, ok, got) { if (!ok) failed++; console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  got " + got)); }
const rec = (id, k) => ({ id, quoteId: "q" + id, text: "x", status: "done", url: "c1", turnKeys: [k], sourceTurnKey: "m1" });

(async () => {
  const A = tab(), B = tab();
  await A.getHighlightsByUrl("c1"); await B.getHighlightsByUrl("c1"); // both tabs read the chat (empty)
  await A.saveHighlights([rec("a1", "t1"), rec("a2", "t2")]);
  await tick();
  let before = gets;
  await A.getHighlightsByUrl("c1");
  check("a tab's own write: its cached copy kept (no new read)", gets === before, gets - before);
  const saved = await B.saveHighlights([rec("b1", "t1"), rec("b3", "t3")]); // B rebuilt the same chat meanwhile
  await tick();
  check("another tab's write: the cache dropped, read again — a turn stored there isn't stored twice",
    saved.map((r) => r.id).join() === "b3" && data["popup:conv:c1"].items.map((r) => r.id).join() === "a1,a2,b3",
    saved.map((r) => r.id).join() + " / " + data["popup:conv:c1"].items.map((r) => r.id).join());
  before = gets;
  const seen = await A.getHighlightsByUrl("c1");
  check("...and the first tab sees it (read again)", gets === before + 1 && seen.length === 3, seen.length);
  // audit #4: an edit's version stored when sent (pending), then done: one record, done, the old version inactive
  await A.saveHighlight({ id: "e1", quoteId: "qa1", text: "x", status: "pending", url: "c1", turnKeys: [], active: true });
  await A.saveHighlight({ id: "e1", quoteId: "qa1", text: "x", status: "done", url: "c1", turnKeys: ["t9"], active: true });
  await tick();
  const items = data["popup:conv:c1"].items, e1 = items.filter((r) => r.id === "e1");
  check("an edit stored when sent, then done: one record (done), the old version inactive",
    e1.length === 1 && e1[0].status === "done" && items.find((r) => r.id === "a1").active === false,
    e1.length + " " + (e1[0] || {}).status);
  console.log(failed ? failed + " FAILED" : "all passed");
})();

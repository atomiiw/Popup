// reach-turn-test.js — JR.reachTurn (src/reach-turn.js) on a fake virtual list: mounts only the turns near the scroll
// position, loads earlier turns a page at a time on a scroll at the top (ChatGPT's new front end), can get stuck.
// Usage: node tools/reach-turn-test.js /path/to/Popup
const fs = require("fs"), vm = require("vm"), path = require("path");
const ctx = vm.createContext({ JR: { site: {} }, console, setTimeout, Promise });
vm.runInContext(fs.readFileSync(path.join(process.argv[2] || ".", "src/reach-turn.js"), "utf8"), ctx);
const reach = ctx.JR.reachTurn;
let failed = 0;
function check(name, ok, got) { if (!ok) failed++; console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  got " + JSON.stringify(got))); }
const fast = () => Promise.resolve();

/** n turns of the given heights; `loaded` from the end loaded at first; `page` more on each scroll at the top. */
function fakeList(heights, opts) {
  opts = opts || {};
  const n = heights.length, view = 800;
  let loadedFrom = Math.max(0, n - (opts.loaded || n)), top = 0, lastTop = null, stuck = false;
  function tops() { let y = 0; const out = []; for (let i = loadedFrom; i < n; i++) { out.push({ i, top: y, height: heights[i] }); y += heights[i]; } return out; }
  function height() { return tops().reduce((s, t) => s + t.height, 0); }
  const L = {
    order: heights.map((_, i) => "k" + i),
    top: () => top,
    setTop(v) {
      v = Math.max(0, Math.min(v, Math.max(0, height() - view)));
      // ChatGPT: a scroll at the top loads the page before (keeping what is on screen in place)
      if (v === 0 && lastTop !== null && lastTop > 0 && loadedFrom > 0 && !stuck) {
        const before = height(); loadedFrom = Math.max(0, loadedFrom - (opts.page || 10)); v = height() - before;
      }
      lastTop = top = v;
    },
    height, view: () => view,
    // stuck (live 11-20, the hidden copy): the same last turns mounted wherever it is scrolled
    mounted: () => {
      if (stuck) return tops().slice(-3).map((t) => ({ key: "k" + t.i, top: t.top, height: t.height }));
      const near = tops().filter((t) => t.top < top + view + 400 && t.top + t.height > top - 400);
      // claude.ai keeps the last turn mounted wherever the list is (live NT1: the search took it for "the turns here")
      const all = tops(), last = all[all.length - 1];
      if (opts.stickyLast && near.indexOf(last) < 0) near.push(last);
      return near.map((t) => ({ key: "k" + t.i, top: t.top, height: t.height }));
    },
    find: (k) => L.mounted().some((m) => m.key === k) ? { key: k } : null,
    jam() { stuck = true; },
  };
  top = Math.max(0, height() - view); lastTop = top; // at the bottom, as a chat opens
  return L;
}

(async () => {
  const hs = Array.from({ length: 200 }, (_, i) => 300 + (i * 97) % 900);
  let L = fakeList(hs);
  let r = await reach(L, "k37", L.order, { wait: fast });
  check("all loaded, in the order: reached", r.turn && r.turn.key === "k37", r);

  L = fakeList(hs, { loaded: 12, page: 10 }); // only the last page loaded (ChatGPT's new front end)
  r = await reach(L, "k5", L.order, { wait: fast });
  check("earlier turns not loaded yet: loaded at the top page by page, reached (∧ ∨ gave up after 4 s)", r.turn && r.turn.key === "k5", r);

  L = fakeList(hs, { loaded: 12, page: 10 });
  r = await reach(L, "k5", [], { wait: fast });
  check("no turn order (right after a reload, Claude Code): up from here, loading earlier turns, reached", r.turn && r.turn.key === "k5", r);

  L = fakeList([600, 600, 30000, 600, 600]); // one turn far taller than the screen
  r = await reach(L, "k0", L.order, { wait: fast });
  check("a turn far taller than the screen in between: not taken for stuck, reached", r.turn && r.turn.key === "k0", r);

  L = fakeList(hs, { loaded: 12 }); L.jam();
  r = await reach(L, "k5", L.order, { wait: fast });
  check("a list that draws nothing: 'stuck', not 160 steps", r.why === "stuck", r);

  L = fakeList(hs, { loaded: 12 });
  let calls = 0;
  r = await reach(L, "k3", L.order, { wait: fast, cancel: () => ++calls > 2 });
  check("cancelled (another jump, Esc): stops", r.why === "cancelled", r);

  L = fakeList(hs);
  r = await reach(L, "new-key", L.order, { wait: fast });
  check("a key not in the order (sent since): looked for at the end only, says so", r.why === "not-in-order", r);

  // DeepSeek: a place for each key (its ids), no order — from where the reader is, not thrown to the end first
  L = fakeList(hs);
  L.setTop(60000);
  const tops = [];
  const realSet = L.setTop;
  L.setTop = (v) => { tops.push(Math.round(v)); realSet(v); };
  r = await reach(L, "k40", [], { wait: fast, position: (k) => Number(k.slice(1)) });
  check("a place but no order (DeepSeek): reached, never scrolled to the end first", r.turn && r.turn.key === "k40" && !tops.some((t) => t > 60000), r.why || tops.slice(0, 5));

  // claude.ai (live NT1, old Chrome): the last turn always mounted — the search went up past the target to the top
  const skew = Array.from({ length: 120 }, (_, i) => (i < 90 ? 250 : 1800) + (i * 37) % 200); // short turns, then long ones
  L = fakeList(skew, { stickyLast: true });
  r = await reach(L, "k97", L.order, { wait: fast });
  check("the last turn kept mounted, heights uneven (claude.ai, live NT1: 97 of 119): reached", r.turn && r.turn.key === "k97", r);
  L = fakeList(skew, { stickyLast: true });
  r = await reach(L, "k60", L.order, { wait: fast });
  check("…and one among the short ones", r.turn && r.turn.key === "k60", r);
  // long turns first, then short ones: the first estimate lands above the target; with the last turn always mounted
  // the turns "here" seemed to reach past it — the search went up to the top (live NT1: 24 s, couldn't be loaded)
  const skew2 = Array.from({ length: 120 }, (_, i) => (i < 90 ? 1900 : 300) + (i * 37) % 200);
  L = fakeList(skew2, { stickyLast: true });
  r = await reach(L, "k100", L.order, { wait: fast });
  check("the last turn kept mounted, the estimate above the target: reached (not up to the top)", r.turn && r.turn.key === "k100", r);
  L = fakeList(hs, { stickyLast: true });
  r = await reach(L, "k150", L.order, { wait: fast });
  check("the last turn kept mounted (claude.ai): still reached", r.turn && r.turn.key === "k150", r);
  L = fakeList(hs, { stickyLast: true });
  r = await reach(L, "k20", L.order, { wait: fast });
  check("…and one near the start", r.turn && r.turn.key === "k20", r);

  console.log(failed ? failed + " FAILED" : "all passed");
  process.exit(failed ? 1 : 0);
})();

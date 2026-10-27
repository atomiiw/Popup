// qa-content-test.js — unit test for the Popup message format and the markdown renderer in src/qa-content.js.
// Run: node tools/qa-content-test.js "$PWD"   (exit 1 on failure)
const fs = require("fs"), vm = require("vm");
const src = fs.readFileSync((process.argv[2] || ".") + "/src/qa-content.js", "utf8");
const noop = () => {};
const ctx = { document: { addEventListener: noop, getElementById: () => null }, location: { hash: "" },
  performance: { now: () => 0 }, setTimeout, clearTimeout, Map, Set, console, PerformanceObserver: function () { return { observe: noop }; } };
ctx.window = ctx; ctx.JR = { state: {}, site: {} };
vm.createContext(ctx); vm.runInContext(src, ctx);
const JR = ctx.JR;

let failed = 0;
function check(name, ok, got) { if (!ok) failed++; console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "\n   got " + JSON.stringify(got))); }

// buildMessage → parsePopupMessage round trip
[
  { name: "plain", o: { question: "Why?", text: "the cat", sentence: "I saw the cat today." } },
  { name: "no sentence", o: { question: "Why?", text: "the cat" } },
  { name: "multi-line question", o: { question: "first line\nsecond line", text: "the cat", sentence: "I saw the cat today." } },
  { name: "question quotes a phrase on its own line", o: { question: 'He said "yes"\nwhat did he mean?', text: "the cat", sentence: "I saw the cat today." } },
  { name: "question contains the suffix marker", o: { question: "Answer (For this response only: short)", text: "x", sentence: "x y." } },
  { name: "every length mode", o: { question: "Q", text: "t", sentence: "s t." }, modes: ["concise", "medium"] },
].forEach(c => (c.modes || ["medium"]).forEach(mode => {
  const p = JR.parsePopupMessage(JR.buildMessage(Object.assign({ mode }, c.o)));
  check(c.name + " (" + mode + ")", p && p.question === c.o.question && p.text === c.o.text && (p.sentence || null) === (c.o.sentence || null), p);
}));

// Blank lines in a question are collapsed before sending (they would split the message).
{
  const p = JR.parsePopupMessage(JR.buildMessage({ question: 'Compare "a"\n\n\nwith b', text: "the cat", mode: "medium" }));
  check("blank lines collapsed", p && p.question === 'Compare "a"\nwith b' && p.text === "the cat", p);
}
check("empty question refused", (() => { try { JR.buildMessage({ question: "  ", text: "x" }); return false; } catch (e) { return true; } })());
check("recognised as Popup message", JR.isPopupMessage(JR.buildMessage({ question: "Q", text: "t", mode: "concise" })));
check("user's own message not recognised", !JR.isPopupMessage("Regarding this part of your response, I disagree."));

// Reply to the whole response
{
  const p = JR.parsePopupMessage(JR.buildMessage({ question: "Summarize", wholeResponse: true, mode: "medium" }));
  check("whole response", p && p.question === "Summarize" && p.wholeResponse === true, p);
}

// renderMarkdown never lets HTML or script URLs through
[
  "<img src=x onerror=alert(1)>",
  "[a](javascript:alert(1))",
  '[a](https://x.com/" onmouseover="alert(1))',
  "`<b>` and ```js\n<script>x</script>\n```",
  "| a | b |\n|---|---|\n| <i>1</i> | 2 |",
].forEach(s => {
  const html = JR.renderMarkdown(s);
  check("escaped: " + JSON.stringify(s).slice(0, 40), !/<(img|script|i>|b>)|href="javascript:|onmouseover="/i.test(html), html);
});

// Formulas in read-back answers: plain TeX, untouched by emphasis, no inner padding.
{
  const html = JR.renderMarkdown("Use \\( Z_0 + R_S_x \\) and *x*.");
  check("formula kept as TeX", html.indexOf("\\(Z_0 + R_S_x\\)") !== -1 && html.indexOf("<em>x</em>") !== -1, html);
}

console.log(failed ? failed + " FAILED" : "all passed");
process.exit(failed ? 1 : 0);

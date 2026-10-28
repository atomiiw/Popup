// net-tap-test.js — unit test for the Popup-turn filter and parent fix in src/net-tap.js.
// Run: osascript -l JavaScript tools/net-tap-test.js "$PWD"   (prints PASS/FAIL lines; exit 1 on failure)
ObjC.import("Foundation");
function run(argv) {
  var src = $.NSString.stringWithContentsOfFileEncodingError(argv[0] + "/src/net-tap.js", $.NSUTF8StringEncoding, null).js;
  function cut(start, end) { var a = src.indexOf(start), b = src.indexOf(end, a); if (a < 0 || b < 0) throw new Error("marker missing: " + start); return src.slice(a, b); }
  var code = [
    "var location = { hash: '' }; var document = { getElementById: function () { return null; }, body: null };",
    "function questionFromBody() { return null; }",
    cut("  var POPUP_PREFIXES", "  /** The user's question inside"),
    cut("  function filterOn()", "  window.fetch ="),
    "return { filterPage: filterPage, correctParent: correctParent, fixRequest: fixRequest, status: function () { return filterStatus; } };",
  ].join("\n");
  var api = (new Function(code))();

  var P = 'Regarding this part of your response:\n"x"\n\nwhy\n\n(For this response only: brief)';
  function msg(id, role, text, ex, t) { return { id: id, author: { role: role }, content: { parts: [text] }, metadata: { turn_exchange_id: ex }, create_time: t }; }
  function ids(j) { return j ? j.messages.map(function (m) { return m.id; }).join(",") : "unchanged"; }
  var out = [], failed = 0;
  function check(name, got, want) {
    var ok = got === want; if (!ok) failed++;
    out.push((ok ? "PASS " : "FAIL ") + name + " -> " + got + (ok ? "" : "   [want " + want + "]"));
  }

  // First screen: u1 a1, two Popup turns (one with a system message), u3 a3.
  var first = { messages: [
    msg("u1", "user", "hello", "e1", 1), msg("a1", "assistant", "hi", "e1", 2),
    msg("pu1", "user", P, "e2", 3), msg("pa1", "assistant", "because", "e2", 4),
    msg("pu2", "user", P, "e3", 5), msg("ps2", "system", "", "e3", 6), msg("pa2", "assistant", "so", "e3", 7),
    msg("u3", "user", "next", "e4", 8), msg("a3", "assistant", "ok", "e4", 9),
  ] };
  check("filter keeps visible turns", ids(api.filterPage("c", first, true)), "u1,a1,u3,a3");
  check("edit u3 (page parent a1)", api.correctParent("c", "a1"), "pa2");
  check("new message after a3", api.correctParent("c", "a3"), null);
  check("regenerate a3 (parent u3)", api.correctParent("c", "u3"), null);
  check("unknown parent", api.correctParent("c", "zzz"), null);
  check("other conversation", api.correctParent("other", "a1"), null);
  check("same first screen again keeps state", (api.filterPage("c", first, true), api.correctParent("c", "a1")), "pa2");

  // Older page (scrolling up) ends with a visible message followed, on the newer page, by Popup turns.
  var first2 = { messages: [msg("pu7", "user", P, "e7", 30), msg("pa7", "assistant", "x", "e7", 31), msg("u8", "user", "q", "e8", 32), msg("a8", "assistant", "y", "e8", 33)] };
  api.filterPage("d", first2, true);
  api.filterPage("d", { messages: [msg("u6", "user", "q", "e6", 20), msg("a6", "assistant", "y", "e6", 21)] }, false);
  check("run across page boundary", api.correctParent("d", "a6"), "pa7");

  // Trailing Popup turns.
  api.filterPage("t", { messages: [msg("u9", "user", "q", "e9", 10), msg("a9", "assistant", "y", "e9", 11), msg("pu9", "user", P, "e10", 12), msg("pa9", "assistant", "x", "e10", 13)] }, true);
  check("new message after trailing Popup turns", api.correctParent("t", "a9"), "pa9");

  // Branches: a new first screen (other branch) replaces the old one; no mixing by time.
  api.filterPage("b", { messages: [msg("u2", "user", "q", "x2", 2), msg("a2", "assistant", "y", "x2", 3), msg("u3x", "user", "q", "x3", 4), msg("a3x", "assistant", "y", "x3", 5)] }, true);
  api.filterPage("b", { messages: [msg("u2y", "user", "q", "y2", 6), msg("a2y", "assistant", "y", "y2", 7), msg("py", "user", P, "y3", 8), msg("pay", "assistant", "x", "y3", 9)] }, true);
  check("after a branch switch, old branch parent is unknown", api.correctParent("b", "a3x"), null);
  check("current branch still fixed", api.correctParent("b", "a2y"), "pay");

  // Popup answer without create_time: page order still decides.
  api.filterPage("n", { messages: [msg("u1", "user", "q", "e1", 1), msg("a1", "assistant", "y", "e1", 2), msg("p", "user", P, "e2", 3), msg("pa", "assistant", "x", "e2", null)] }, true);
  check("missing create_time", api.correctParent("n", "a1"), "pa");

  // First screen entirely Popup: filtered to empty (ChatGPT then loads older pages, verified live, T35);
  // the next message from the last visible one on an older page goes after the hidden turns.
  check("first screen all Popup", ids(api.filterPage("e", { messages: [msg("p1", "user", P, "f1", 10), msg("q1", "assistant", "x", "f1", 11)] }, true)), "");
  check("  ... no fallback", api.status().fallback, null);
  api.filterPage("e", { messages: [msg("u0", "user", "q", "f0", 1), msg("a0", "assistant", "y", "f0", 2)] }, false);
  check("  ... parent after the hidden first screen", api.correctParent("e", "a0"), "q1");

  // Missing turn_exchange_id on a Popup message: nothing filtered.
  var bad = msg("pz", "user", P, null, 1); bad.metadata = {};
  check("missing turn_exchange_id", ids(api.filterPage("z", { messages: [bad] }, true)), "unchanged");

  // Request bodies.
  check("fixRequest edit", JSON.parse(api.fixRequest("u", JSON.stringify({ action: "next", conversation_id: "c", parent_message_id: "a1" }))).parent_message_id, "pa2");
  check("fixRequest other conversation", JSON.parse(api.fixRequest("u", JSON.stringify({ action: "next", conversation_id: "zz", parent_message_id: "a1" }))).parent_message_id, "a1");
  check("fixRequest new chat (no conversation_id)", JSON.parse(api.fixRequest("u", JSON.stringify({ action: "next", parent_message_id: "a1" }))).parent_message_id, "a1");
  check("fixRequest not JSON", api.fixRequest("u", "notjson"), "notjson");

  out.push(failed ? failed + " FAILED" : "all passed");
  if (failed) { console.log(out.join("\n")); $.exit(1); }
  return out.join("\n");
}

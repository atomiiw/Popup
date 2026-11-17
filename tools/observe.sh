#!/bin/bash
# Install all read-only observers in the user's Chrome tab (Apple Events JS, no DevTools protocol):
# send recorder, frame snapshot, error/console.error hook, backend fetch log.
#   tools/observe.sh <conv-id-prefix> "<sentence the test will highlight>"
# Then do the send by hand / Computer Use, and read back with: python3 tools/send-report.py <conv> <out-dir>
set -u
cd "$(dirname "$0")/.."
C=$1; TXT=${2:-}
python3 tools/chrome_js.py --url "$C" @tools/send-recorder.js
python3 tools/chrome_js.py --url "$C" @tools/send-snapshot.js
python3 tools/chrome_js.py --url "$C" "$(cat <<'JS'
(function(){
  if (!window.__jrErr) {
    window.__jrErr = [];
    var push = function (kind, a) { try { window.__jrErr.push({ t: Math.round(performance.now()), kind: kind,
      msg: String(a && a.message || a).slice(0, 200), stack: String(a && a.stack || "").split("\n").slice(0, 4).join(" | ").slice(0, 300) }); } catch (e) {} };
    window.addEventListener("error", function (e) { push("error", e.error || e.message); }, true);
    window.addEventListener("unhandledrejection", function (e) { push("rejection", e.reason); });
    var ce = console.error; console.error = function () { push("console.error", arguments[0] && arguments[0].stack ? arguments[0] : [].slice.call(arguments).map(String).join(" ")); return ce.apply(this, arguments); };
  }
  if (!window.__jrFetchLog) {
    window.__jrFetchLog = []; var o = window.fetch;
    window.fetch = function (i, init) { var u = typeof i === "string" ? i : (i && i.url) || "";
      if (/backend-api|backend-anon/.test(u)) window.__jrFetchLog.push({ t: Math.round(performance.now()), m: ((init && init.method) || "GET").toUpperCase(), u: u.replace(/^https:\/\/chatgpt.com/, "").replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id").slice(0, 90) });
      return o.apply(this, arguments); };
  }
  return "observers on";
})()
JS
)"
[ -n "$TXT" ] && python3 tools/chrome_js.py --url "$C" "window.__jrRecText = $(printf '%s' "$TXT" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))'); 'target set'"

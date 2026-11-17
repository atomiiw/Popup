#!/usr/bin/env python3
"""After a send done by hand / Computer Use in the user's Chrome: read the recorders back (Apple Events,
read-only JS, no DevTools protocol) and summarise.   python3 tools/send-report.py <conv-id-prefix> <out-dir>
Install first:  python3 tools/chrome_js.py --url <conv> @tools/send-recorder.js   (and @tools/send-snapshot.js)
"""
import json, os, subprocess, sys

conv, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
here = os.path.dirname(os.path.abspath(__file__))

def js(expr):
    r = subprocess.run([sys.executable, os.path.join(here, "chrome_js.py"), "--url", conv, expr], capture_output=True, text=True)
    return r.stdout.strip()

data = {
    "rec": js("JSON.stringify(window.__jrRec || [])"),
    "snap": js("JSON.stringify(window.__jrSnap || null)"),
    "poslog": js('(document.getElementById("jr-poslog") || {getAttribute: function(){return "[]"}}).getAttribute("data-json")'),
}
for k, v in data.items():
    open(os.path.join(out, k + ".json"), "w").write(v)

recs = json.loads(data["rec"] or "[]")
if not recs:
    sys.exit("no recording: was the recorder installed before the send?")
rec = recs[-1]
rows = rec["rows"]
f, l = rows[0], rows[-1]
moves = [r for a, r in zip(rows, rows[1:]) if r["st"] != a["st"]]
bad, t_bad = 0, None
for r in rows:
    off = r["hl"] is None or (f["hl"] is not None and abs(r["hl"] - f["hl"]) > 2)
    if off and t_bad is None: t_bad = r["t"]
    if not off and t_bad is not None: bad += r["t"] - t_bad; t_bad = None
if t_bad is not None: bad += rows[-1]["t"] - t_bad
print(f"{rec['how']}: highlight {f['hl']} -> {l['hl']}, popup {f['pop']} -> {l['pop']}, scrollTop {f['st']} -> {l['st']}")
print(f"SMOOTHNESS: highlight away from its place {bad} ms; scrollTop changed {len(moves)} times: " +
      ", ".join(f"{r['t']}ms->{r['st']}" for r in moves[:12]))
locks = [e["info"] for e in json.loads(data["poslog"] or "[]") if e.get("fn") == "lock"]
print("lock corrections:", locks[:8])
snap = json.loads(data["snap"] or "null")
if snap and snap.get("frames"):
    print("snapshot frames (t: scrollTop, listH, anchor-turn text):")
    for fr in snap["frames"][:14]:
        print(f"  {fr['t']}: st {fr['st']} listH {fr['listH']} passage {fr['passage']} | {fr['turns'][:150]}")
errs = json.loads(js("JSON.stringify(window.__jrErr || [])") or "[]")
fetches = json.loads(js("JSON.stringify(window.__jrFetchLog || [])") or "[]")
open(os.path.join(out, "errors.json"), "w").write(json.dumps(errs)); open(os.path.join(out, "fetch.json"), "w").write(json.dumps(fetches))
t0 = rec.get("t0abs")
print(f"errors ({len(errs)}):"); [print("  ", e["t"], e["kind"], e["msg"][:150], "|", e["stack"][:160]) for e in errs[-8:]]
print(f"backend fetches ({len(fetches)}):"); [print("  ", f["t"], f["m"], f["u"]) for f in fetches[-12:]]
print("files:", out)

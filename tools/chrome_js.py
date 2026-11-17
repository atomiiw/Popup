#!/usr/bin/env python3
"""Run JavaScript in the user's Chrome (needs View > Developer > Allow JavaScript from Apple Events).

  python3 tools/chrome_js.py [--url chatgpt.com] 'expr'      # or @file.js
Runs in the first tab whose URL contains --url (page MAIN world; Popup's content
scripts live in an isolated world, but the DOM is shared). Prints the result
(objects: return JSON.stringify(...) yourself).
"""
import argparse, subprocess, sys

ap = argparse.ArgumentParser()
ap.add_argument("--url", default="chatgpt.com")
ap.add_argument("js")
a = ap.parse_args()
js = open(a.js[1:]).read() if a.js.startswith("@") else a.js
esc = js.replace("\\", "\\\\").replace('"', '\\"')
script = f'''
tell application "Google Chrome"
  repeat with w in windows
    repeat with t in tabs of w
      if URL of t contains "{a.url}" then return execute t javascript "{esc}"
    end repeat
  end repeat
  return "NO TAB matching {a.url}"
end tell'''
r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
sys.stdout.write(r.stdout); sys.stderr.write(r.stderr); sys.exit(r.returncode)

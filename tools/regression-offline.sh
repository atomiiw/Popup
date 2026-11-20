#!/bin/bash
# regression-offline.sh — every offline check of docs/REGRESSION.md part A, in one command.
# Needs: macOS (osascript runs two of the tests), Node >= 18 (`node` on PATH, or NODE=/path/to/node),
# Google Chrome (CHROME=/path/to/chrome if not in /Applications).
# Usage: tools/regression-offline.sh        Prints one line per check; exit 1 if any check fails.
cd "$(dirname "$0")/.." || exit 2
NODE=${NODE:-$(command -v node)}
CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
fails=0
line() { printf '%-34s %s\n' "$1" "$2"; [ "$2" = PASS ] || fails=$((fails + 1)); }

[ -x "$NODE" ] || { echo "node not found: install Node >= 18 or set NODE=/path/to/node"; exit 2; }
[ -x "$CHROME" ] || { echo "Chrome not found: set CHROME=/path/to/chrome"; exit 2; }

bad=""
for f in src/*.js src/sites/*.js content.js storage.js; do "$NODE" --check "$f" 2>/dev/null || bad="$bad $f"; done
line "A1 syntax (all scripts)" "$([ -z "$bad" ] && echo PASS || echo "FAIL:$bad")"

out=$("$NODE" tools/qa-content-test.js "$PWD" 2>&1 | tail -1)
line "A2 message format (qa-content)" "$([ "$out" = "all passed" ] && echo PASS || echo "FAIL: $out")"

out=$("$NODE" tools/storage-test.js "$PWD" 2>&1 | tail -1)
line "A2b storage (two tabs, rebuild)" "$([ "$out" = "all passed" ] && echo PASS || echo "FAIL: $out")"

out=$(osascript -l JavaScript tools/net-tap-test.js "$PWD" 2>&1 | tail -1)
line "A3 ChatGPT data filter (net-tap)" "$([ "$out" = "all passed" ] && echo PASS || echo "FAIL: $out")"

for h in chatgpt.com chat.deepseek.com claude.ai; do
  out=$(osascript -l JavaScript tools/load-smoke.js "$PWD" "$h" 2>&1 | grep '^FAIL' | head -3)
  line "A4 load order ($h)" "$([ -z "$out" ] && echo PASS || echo "FAIL: $out")"
done

# Headless Chrome now and then quits before the page finishes: up to 3 tries, judged by the page title.
for t in dom-test dom-test-deepseek dom-test-claude scroll-guard-test net-tap-page-test; do
  res=""
  for try in 1 2 3; do
    dom=$("$CHROME" --headless=new --user-data-dir="$(mktemp -d)" --allow-file-access-from-files \
      --virtual-time-budget=30000 --dump-dom "file://$PWD/tools/$t.html" 2>/dev/null)
    title=$(echo "$dom" | grep -o '<title>[A-Z]*</title>' | sed 's/<[^>]*>//g')
    if [ "$title" = PASS ]; then res=PASS; break; fi
    if [ "$title" = FAIL ]; then res="FAIL: $(echo "$dom" | sed -n '/<pre id="out">/,/<\/pre>/p' | grep -E 'FAIL' | head -3 | tr '\n' ' ')"; break; fi
  done
  line "A5 $t.html" "${res:-FAIL: no result after 3 tries}"
done

echo
[ "$fails" -eq 0 ] && echo "ALL PASS ($(grep -o '"version_name": "[^"]*"' manifest.json))" || echo "$fails FAILED"
[ "$fails" -eq 0 ]

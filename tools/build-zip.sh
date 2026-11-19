#!/bin/bash
# Store zip of the extension: only the files manifest.json loads (no docs, tools, collab). → dist/popup-<version>.zip
set -e
cd "$(dirname "$0")/.."
V=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")
FILES=$(python3 -c "
import json; m=json.load(open('manifest.json')); f={'manifest.json'}
for c in m['content_scripts']: f.update(c.get('js', [])); f.update(c.get('css', []))
f.update(m.get('icons', {}).values()); f.update((m.get('action') or {}).get('default_icon', {}).values())
for w in m.get('web_accessible_resources', []): f.update(w.get('resources', []))
print(' '.join(sorted(f)))")
mkdir -p dist && rm -f "dist/popup-$V.zip"
zip -q -X "dist/popup-$V.zip" $FILES
echo "dist/popup-$V.zip ($(echo $FILES | wc -w | tr -d ' ') files)"

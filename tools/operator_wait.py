#!/Users/mw582/.venvs/collab/bin/python
"""operator inbox: block until commander posts a new message to operator on collab/BOARD.md.

  tools/operator_wait.py            # wait up to 540 s; print every new `commander → operator` post, then exit
  tools/operator_wait.py --peek     # print unread posts (if any) without waiting

Read position lives in collab/.operator_seen (last board line already read), so nothing is
delivered twice and nothing is missed between calls. Prints NO-MESSAGE on timeout: just call again.
"""
import os, re, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOARD = os.path.join(ROOT, "collab", "BOARD.md")
SEEN = os.path.join(ROOT, "collab", ".operator_seen")
HDR = re.compile(r"^### \[.+?\] (.+?) → (.+?) \| 需要回复：")
TIMEOUT = 540


def read_seen(n_lines):
    try:
        return int(open(SEEN).read().strip())
    except Exception:
        return n_lines  # first run: start from the current end


def unread(lines, seen):
    """Posts addressed to operator (or 全部) after line `seen`, as text blocks."""
    posts, cur = [], None
    for i in range(seen, len(lines)):
        m = HDR.match(lines[i])
        if m:
            cur = None
            if not m.group(1).startswith("operator") and ("operator" in m.group(2) or "全部" in m.group(2)):
                cur = [f"L{i + 1} {lines[i]}"]
                posts.append(cur)
        elif cur is not None:
            cur.append(lines[i])
    return ["\n".join(p).rstrip() for p in posts]


lines = open(BOARD, encoding="utf-8").read().splitlines()
seen = read_seen(len(lines))
end = time.time() + (0 if "--peek" in sys.argv else TIMEOUT)
while True:
    lines = open(BOARD, encoding="utf-8").read().splitlines()
    seen = min(seen, len(lines))
    posts = unread(lines, seen)
    if posts:
        time.sleep(1)  # let a multi-line append finish
        lines = open(BOARD, encoding="utf-8").read().splitlines()
        print("\n\n".join(unread(lines, seen)))
        open(SEEN, "w").write(str(len(lines)))
        break
    if time.time() >= end:
        open(SEEN, "w").write(str(len(lines)))
        print("NO-MESSAGE")
        break
    time.sleep(2)

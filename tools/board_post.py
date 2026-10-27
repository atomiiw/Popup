#!/Users/mw582/.venvs/collab/bin/python
"""Append one post to collab/BOARD.md with the protocol header and a real timestamp.

  tools/board_post.py --from operator --to commander --reply 是 --body "line 1" --body "line 2"
  echo "body text" | tools/board_post.py --from operator --to commander

Header written: ### [YYYY-MM-DD HH:MM:SS] <from> → <to> | 需要回复：是/否
Evidence (screenshots, DOM dumps) goes in collab/evidence/ and is referenced by path in the body.
"""
import argparse, os, sys, time

BOARD = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "collab", "BOARD.md")

ap = argparse.ArgumentParser()
ap.add_argument("--from", dest="sender", required=True)
ap.add_argument("--to", required=True)
ap.add_argument("--reply", default="否", choices=["是", "否", "yes", "no"])
ap.add_argument("--body", action="append", default=[])
a = ap.parse_args()

body = list(a.body)
if not body and not sys.stdin.isatty():
    body = sys.stdin.read().rstrip("\n").splitlines()
if not body:
    sys.exit("empty post")
if any(l.startswith("### ") for l in body):
    sys.exit("body lines must not start with '### ' (that is the post header)")
reply = "是" if a.reply in ("是", "yes") else "否"
header = f"### [{time.strftime('%Y-%m-%d %H:%M:%S')}] {a.sender} → {a.to} | 需要回复：{reply}"
with open(BOARD, "a", encoding="utf-8") as f:
    f.write("\n" + header + "\n" + "\n".join(body) + "\n")
print("posted:", header)

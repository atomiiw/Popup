#!/Users/mw582/.venvs/collab/bin/python
"""Commander event stream for the Popup collab: one stdout line per event.

Run it under Claude Code's Monitor tool so each line wakes the commander:
- BOARD   a new collab/BOARD.md post addressed to commander (`### [...] X → commander | 需要回复：...`)
- CODEX   operator finished a turn (its rollout logs task_complete), with the start of its last message
- CODEX   operator turn aborted / hit a usage limit
"""
import glob, json, os, re, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOARD = os.path.join(ROOT, "collab", "BOARD.md")
CODEX = {"operator": "01a18502-a2c1-7b30-9ab2-94531782c571"}
HDR = re.compile(r"^### \[(.+?)\] (.+?) → (.+?) \| 需要回复：(\S+)")


def rollout(tid):
    files = glob.glob(os.path.expanduser(f"~/.codex/sessions/*/*/*/rollout-*-{tid}.jsonl"))
    return max(files, key=os.path.getmtime) if files else None


def emit(s):
    print(s, flush=True)


board_lines = sum(1 for _ in open(BOARD))
offsets = {}
for name, tid in CODEX.items():
    f = rollout(tid)
    offsets[name] = (f, os.path.getsize(f) if f else 0)

while True:
    try:
        lines = open(BOARD).read().splitlines()
        if len(lines) < board_lines:  # board rewritten
            board_lines = len(lines)
        for i, ln in enumerate(lines[board_lines:], board_lines + 1):
            m = HDR.match(ln)
            if m and "commander" in m.group(3) and not m.group(2).startswith("commander"):
                emit(f"BOARD L{i} {m.group(1)} {m.group(2)} → {m.group(3)} | 需要回复：{m.group(4)}")
        board_lines = len(lines)
        for name, tid in CODEX.items():
            f, off = offsets[name]
            f2 = rollout(tid)
            if f2 != f:
                f, off = f2, 0
            if not f:
                continue
            size = os.path.getsize(f)
            if size > off:
                with open(f) as fh:
                    fh.seek(off)
                    chunk = fh.read()
                for raw in chunk.splitlines():
                    if '"task_complete"' in raw:
                        try:
                            last = json.loads(raw)["payload"].get("last_agent_message") or ""
                        except Exception:
                            last = ""
                        emit(f"CODEX {name} 本轮结束（空闲）：{' '.join(last.split())[:300]}")
                    elif '"turn_aborted"' in raw or '"usage_limit' in raw:
                        emit(f"CODEX {name} 异常：{raw[:160]}")
                off = size
            offsets[name] = (f, off)
    except Exception as e:  # keep watching
        emit(f"WATCH-ERROR {e}")
    time.sleep(2)

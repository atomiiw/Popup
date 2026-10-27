#!/Users/mw582/.venvs/collab/bin/python
"""Deliver a message to a Codex session immediately (no queue).

Talks to the shared local app-server daemon (JSON-RPC over WebSocket on its
Unix control socket, the same channel the Codex TUI uses):
  - session busy -> `turn/steer`: the text is injected into the running turn
  - session idle -> `turn/start`: a new turn starts right away

Usage:
  codex_send.py <session id|name> "message"      # send
  codex_send.py <session id|name> --status        # read-only status check
  codex_send.py <session id|name> --restart "msg" # interrupt the running turn, start a new one
                                                  # (needed when the session's permissions changed)
  codex_send.py <session id|name> --compact       # compact the thread (after repeated stream disconnects)
Session names come from ~/.codex/session_index.jsonl (e.g. operator).
"""
import json, os, sys, time, uuid, warnings

warnings.filterwarnings("ignore", category=DeprecationWarning)

INDEX = os.path.expanduser("~/.codex/session_index.jsonl")
SOCK = os.path.expanduser("~/.codex/app-server-control/app-server-control.sock")


def resolve(target):
    if len(target) == 36 and target.count("-") == 4:
        return target
    hit = None
    for line in open(INDEX):
        row = json.loads(line)
        if row.get("thread_name") == target:
            hit = row["id"]  # latest entry wins
    if not hit:
        sys.exit(f"no Codex session named {target!r}")
    return hit


class Rpc:
    """JSON-RPC over WebSocket on the daemon's Unix control socket (same channel the Codex TUI uses)."""

    def __init__(self):
        from websockets.sync.client import unix_connect
        self.ws = unix_connect(SOCK, uri="ws://localhost/")
        self.n = 0

    def call(self, method, params, timeout=30):
        self.n += 1
        rid = self.n
        self.ws.send(json.dumps({"jsonrpc": "2.0", "id": rid, "method": method, "params": params}))
        end = time.time() + timeout
        while time.time() < end:
            msg = json.loads(self.ws.recv(timeout=max(0.1, end - time.time())))
            if msg.get("id") == rid and "method" not in msg:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg["result"]
        raise TimeoutError(method)

    def notify(self, method, params=None):
        self.ws.send(json.dumps({"jsonrpc": "2.0", "method": method, "params": params or {}}))

    def close(self):
        self.ws.close()


def active_turn(rpc, tid):
    res = rpc.call("thread/turns/list", {"threadId": tid, "limit": 3, "sortDirection": "desc"})
    for t in res.get("data", []):
        if t.get("status") in ("inProgress", "in_progress", "running"):
            return t["id"]
    return None


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    tid = resolve(sys.argv[1])
    rpc = Rpc()
    try:
        rpc.call("initialize", {"clientInfo": {"name": "claude-commander", "version": "1.0"}})
        rpc.notify("initialized")
        th = rpc.call("thread/resume", {"threadId": tid, "excludeTurns": True})["thread"]
        status = th["status"]["type"]
        turn = active_turn(rpc, tid) if status == "active" else None
        if sys.argv[2] == "--status":
            print(json.dumps({"thread": tid, "name": th.get("name"), "status": status, "activeTurn": turn}))
            return
        if sys.argv[2] == "--compact":  # shrink context after repeated "stream disconnected" errors
            print(json.dumps(rpc.call("thread/compact/start", {"threadId": tid})))
            return
        restart = sys.argv[2] == "--restart"
        text = sys.argv[3] if restart else sys.argv[2]
        if restart and turn:
            rpc.call("turn/interrupt", {"threadId": tid, "turnId": turn})
            for _ in range(60):  # wait for the turn to wind down
                time.sleep(1)
                if active_turn(rpc, tid) is None:
                    break
            turn = None
        item = [{"type": "text", "text": text, "text_elements": []}]
        cid = str(uuid.uuid4())
        if turn:
            try:
                rpc.call("turn/steer", {"threadId": tid, "expectedTurnId": turn, "input": item,
                                        "clientUserMessageId": cid})
                print(f"STEERED into active turn {turn} of {tid}")
                return
            except RuntimeError as e:  # turn ended between check and send
                print(f"steer failed ({e}); starting a new turn", file=sys.stderr)
        res = rpc.call("turn/start", {"threadId": tid, "input": item, "clientUserMessageId": cid})
        print(f"STARTED turn {res.get('turn', {}).get('id')} on {tid}")
    finally:
        rpc.close()


if __name__ == "__main__":
    main()

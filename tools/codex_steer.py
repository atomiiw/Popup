#!/Users/mw582/.venvs/collab/bin/python
"""Steer a message into a running Codex desktop turn (no queue, no daemon, no admin).

Uses the desktop app's own IPC router (~/.codex/ipc/ipc.sock; frames = 4-byte LE length
+ JSON): "initialize", then "thread-follower-steer-turn" to the window that owns the thread.
If the session is idle there is nothing to steer: falls back to `codex queue`, which an idle
session picks up within seconds.

  tools/codex_steer.py operator "commander → operator：..."
"""
import json, os, socket, struct, subprocess, sys, uuid

SOCK = os.path.expanduser("~/.codex/ipc/ipc.sock")
INDEX = os.path.expanduser("~/.codex/session_index.jsonl")
CODEX = os.path.expanduser("~/.local/bin/codex")
CWD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSION = {"initialize": 0, "thread-follower-steer-turn": 1}  # IPC version table in app.asar


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


def send(s, msg):
    data = json.dumps(msg).encode()
    s.sendall(struct.pack("<I", len(data)) + data)


def recv(s):
    def read(n):
        buf = b""
        while len(buf) < n:
            chunk = s.recv(n - len(buf))
            if not chunk:
                raise ConnectionError("ipc closed")
            buf += chunk
        return buf
    return json.loads(read(struct.unpack("<I", read(4))[0]))


def request(s, client_id, method, params):
    rid = str(uuid.uuid4())
    send(s, {"type": "request", "requestId": rid, "sourceClientId": client_id,
             "version": VERSION[method], "method": method, "params": params, "timeoutMs": 15000})
    while True:
        msg = recv(s)
        if msg.get("type") == "response" and msg.get("requestId") == rid:
            return msg
        if msg.get("type") == "client-discovery-request":  # we handle no requests ourselves
            send(s, {"type": "client-discovery-response", "requestId": msg["requestId"], "response": {"canHandle": False}})


def steer(tid, text):
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(20)
    s.connect(SOCK)
    try:
        cid = request(s, "initializing-client", "initialize", {"clientType": "claude-commander"})["result"]["clientId"]
        mid = str(uuid.uuid4())
        item = [{"type": "text", "text": text, "text_elements": []}]
        return request(s, cid, "thread-follower-steer-turn", {
            "conversationId": tid, "clientUserMessageId": mid, "input": item,
            "restoreMessage": {"id": mid, "text": text, "input": item, "cwd": CWD,
                               "context": {"workspaceRoots": [CWD]}}})
    finally:
        s.close()


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    tid, text = resolve(sys.argv[1]), sys.argv[2]
    res = steer(tid, text)
    if res.get("resultType") == "success":
        print(f"STEERED into the running turn of {tid}")
        return
    print(f"steer not possible ({res.get('error')}); queueing instead", file=sys.stderr)
    subprocess.run([CODEX, "queue", "--thread", tid, "--message", text], check=True)


if __name__ == "__main__":
    main()

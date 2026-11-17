#!/Users/mw582/.venvs/collab/bin/python
"""Steer a message into a running Codex desktop turn (no queue, no daemon, no admin).

Uses the desktop app's own IPC router (~/.codex/ipc/ipc.sock; frames = 4-byte LE length
+ JSON): "initialize", then "thread-follower-steer-turn" to the window that owns the thread.
If the session is idle there is nothing to steer: starts a new turn with
"thread-follower-start-turn" (shows in the app at once). Never queues (a queued message
waits until the user sees it / the turn ends).

  tools/codex_steer.py operator "commander → operator：..."
"""
import json, os, socket, struct, sys, time, uuid

SOCK = os.path.expanduser("~/.codex/ipc/ipc.sock")
INDEX = os.path.expanduser("~/.codex/session_index.jsonl")
CWD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSION = {"initialize": 0, "thread-follower-steer-turn": 1, "thread-follower-start-turn": 2}  # IPC version table in app.asar


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


def deliver(tid, text, method):
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(20)
    s.connect(SOCK)
    try:
        cid = request(s, "initializing-client", "initialize", {"clientType": "claude-commander"})["result"]["clientId"]
        mid = str(uuid.uuid4())
        item = [{"type": "text", "text": text, "text_elements": []}]
        restore = {"id": mid, "text": text, "input": item, "cwd": CWD, "createdAt": int(time.time() * 1000),
                   "context": {"prompt": text, "workspaceRoots": [CWD]}}
        if method == "thread-follower-steer-turn":
            params = {"conversationId": tid, "clientUserMessageId": mid, "input": item, "restoreMessage": restore}
        else:
            params = {"conversationId": tid, "turnStart": {
                "request": {"threadId": tid, "clientUserMessageId": mid, "input": item},
                "context": {"restoreMessage": restore}}}
        return request(s, cid, method, params)
    finally:
        s.close()


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    tid, text = resolve(sys.argv[1]), sys.argv[2]
    for method, done in (("thread-follower-steer-turn", "STEERED into the running turn of"),
                         ("thread-follower-start-turn", "STARTED a new turn in")):
        try:
            res = deliver(tid, text, method)
        except (OSError, ConnectionError, KeyError) as e:  # desktop app not running / IPC changed
            res = {"error": f"ipc: {e}"}
        if res.get("resultType") == "success":
            print(f"{done} {tid}")
            return
        print(f"{method}: {res.get('error')}", file=sys.stderr)
    sys.exit("NOT DELIVERED (no queue fallback) — is the Codex app open with the operator session?")


if __name__ == "__main__":
    main()

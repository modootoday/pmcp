#!/usr/bin/env python3
"""A fake grok for pmcp-pty's delivery tests. 'agent ... stdio' speaks ACP: a session named
needs-load answers -32602 until session/load, and every prompt is preceded by a permission
request that the client must never answer. Anything else is the scripted fake agent TUI."""
import json
import os
import sys

args = sys.argv[1:]
# Both the TUI and the ACP client get --leader-socket; logging beside it reaches the test from
# either process without depending on whose environment the process inherited.
SOCKET = args[args.index("--leader-socket") + 1] if "--leader-socket" in args else "/dev/null"
LOG = os.path.join(os.path.dirname(SOCKET), "acp.log")


def log(line):
    with open(LOG, "a") as f:
        f.write(line + "\n")


def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


if args[:2] == ["agent", "leader"]:
    # Like the live leader, it ignores the polite signals, so only KILL ends it.
    import signal
    import socket
    import time

    signal.signal(signal.SIGHUP, signal.SIG_IGN)
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    server = socket.socket(socket.AF_UNIX)
    server.bind(SOCKET)
    server.listen()
    log("leader pid %d %s" % (os.getpid(), " ".join(args)))
    # A backstop for a crashed test only: orphaned for longer than any reap grace, it leaves on
    # its own, so the tests still see pmcp-pty's KILL do the work.
    orphaned = None
    while True:
        time.sleep(1)
        if os.getppid() != 1:
            orphaned = None
            continue
        orphaned = orphaned or time.monotonic()
        if time.monotonic() - orphaned > 10:
            os._exit(0)

if args[:1] != ["agent"]:
    log("tui " + " ".join(args))
    here = os.path.dirname(os.path.abspath(__file__))
    os.execvp("python3", ["python3", os.path.join(here, "fake_agent.py")])

log("client " + " ".join(args))
loaded = set()
for line in sys.stdin:
    msg = json.loads(line)
    log("recv " + json.dumps(msg, sort_keys=True))
    method = msg.get("method")
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": msg["id"], "result": {"protocolVersion": 1}})
    elif method == "session/load":
        loaded.add(msg["params"]["sessionId"])
        send({"jsonrpc": "2.0", "id": msg["id"], "result": {}})
    elif method == "session/prompt":
        session = msg["params"]["sessionId"]
        if session == "silent":
            continue
        if session == "needs-load" and session not in loaded:
            send({"jsonrpc": "2.0", "id": msg["id"], "error": {"code": -32602, "message": "unknown session"}})
            continue
        send({"jsonrpc": "2.0", "id": 99, "method": "session/request_permission", "params": {}})
        send({"jsonrpc": "2.0", "method": "session/update", "params": {"update": {"sessionUpdate": "user_message_chunk"}}})
        reply = {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "ACP-REPLY"}}
        send({"jsonrpc": "2.0", "method": "session/update", "params": {"update": reply}})
        send({"jsonrpc": "2.0", "id": msg["id"], "result": {"stopReason": "end_turn"}})

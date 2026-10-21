#!/usr/bin/env python3
"""A fake codex for pmcp-pty's delivery tests: app-server listens on a unix socket and logs when
it is stopped, queue logs its arguments, and the TUI (--remote) is the scripted fake agent."""
import os
import signal
import socket
import sys
import time

args = sys.argv[1:]
# Every role gets the app-server socket (--listen or --remote); logging beside it reaches the
# test from processes the daemon starts with its own environment, such as codex queue.
FLAG = next((f for f in ("--listen", "--remote") if f in args), None)
SOCKET = args[args.index(FLAG) + 1].removeprefix("unix://") if FLAG else "/dev/null"
LOG = os.path.join(os.path.dirname(SOCKET), "codex.log")


def log(line):
    with open(LOG, "a") as f:
        f.write(line + "\n")


def read_frame(conn):
    head = conn.recv(2, socket.MSG_WAITALL)
    if len(head) < 2:
        return None
    n = head[1] & 0x7F
    if n == 126:
        n = struct.unpack(">H", conn.recv(2, socket.MSG_WAITALL))[0]
    elif n == 127:
        n = struct.unpack(">Q", conn.recv(8, socket.MSG_WAITALL))[0]
    mask = conn.recv(4, socket.MSG_WAITALL) if head[1] & 0x80 else b"\0\0\0\0"
    body = conn.recv(n, socket.MSG_WAITALL) if n else b""
    return bytes(b ^ mask[i % 4] for i, b in enumerate(body))


def send_frame(conn, text):
    body = text.encode()
    head = bytes([0x81, len(body)]) if len(body) < 126 else bytes([0x81, 126]) + struct.pack(">H", len(body))
    conn.sendall(head + body)


# JSON-RPC over WebSocket like the real app-server's unix socket; thread/loaded/list answers
# with the ids in loaded.json beside the socket, which the test writes.
def serve(conn):
    request = b""
    while b"\r\n\r\n" not in request:
        request += conn.recv(1024)
    key = re.search(rb"Sec-WebSocket-Key: (\S+)", request).group(1)
    accept = base64.b64encode(hashlib.sha1(key + b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest())
    conn.sendall(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + b"\r\n\r\n")
    while (body := read_frame(conn)) is not None:
        msg = json.loads(body)
        log("rpc " + msg.get("method", ""))
        if "id" not in msg:
            continue
        result = {}
        if msg["method"] == "thread/loaded/list":
            loaded = os.path.join(os.path.dirname(SOCKET), "loaded.json")
            result = {"data": json.load(open(loaded)) if os.path.exists(loaded) else []}
        send_frame(conn, json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": result}))


if args[:1] == ["app-server"]:
    import base64
    import hashlib
    import json
    import re
    import struct
    import threading

    path = args[args.index("--listen") + 1].removeprefix("unix://")
    server = socket.socket(socket.AF_UNIX)
    server.bind(path)
    server.listen()
    log("app-server listening " + path)

    def accept_loop():
        while True:
            conn, _ = server.accept()
            threading.Thread(target=serve, args=(conn,), daemon=True).start()

    threading.Thread(target=accept_loop, daemon=True).start()
    # Like the live MCP OAuth refresh failures, which must never reach the TUI's screen.
    sys.stderr.write("ERROR rmcp: invalid_grant (fake)\n")
    sys.stderr.flush()

    def stop(*_):
        log("app-server stopped")
        sys.exit(0)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGHUP, stop)
    while True:
        time.sleep(1)
elif args[:1] == ["queue"]:
    log("queue " + " ".join(args[1:]))
else:
    log("tui " + " ".join(args))
    here = os.path.dirname(os.path.abspath(__file__))
    os.execvp("python3", ["python3", os.path.join(here, "fake_agent.py")])

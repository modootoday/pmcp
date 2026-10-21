"""A scripted agent TUI for pmcp-pty's AI-loop tests: an input line, a user echo, a spinner while
busy, a numbered dialog, a reply that quotes the input, and an exit command. No real agent runs."""
import os
import sys
import time
import tty

FRAMES = "⠋⠙⠹⠸"


def out(text):
    sys.stdout.write(text)
    sys.stdout.flush()


def spin(seconds):
    end = time.time() + seconds
    i = 0
    while time.time() < end:
        out("\r\x1b[K" + FRAMES[i % 4] + " working (esc to cancel)")
        i += 1
        time.sleep(0.08)
    out("\r\x1b[K")


def handle(line):
    out("\r\x1b[Kuser: " + line + "\r\n")
    # An empty Enter stands for a hook running on its own; it stays busy long enough that a test
    # sees it busy even on a loaded host, where half a second was sometimes already over.
    spin(2.0 if line == "" else 0.5)
    if line == "exit":
        out("bye\r\n")
        sys.exit(3)
    if line == "stale-dialog":
        # A dialog string left in history, as a TUI that never clears it would.
        out("Allow execution of: 'old'?\r\n> ")
        return
    if line == "dialog":
        out("Allow execution of: 'rm -rf build'?\r\n● 1. Allow once\r\n  2. Deny\r\n")
        choice = sys.stdin.read(1)
        # Like a real TUI, the answered dialog box is removed from the screen.
        out("\x1b[3A\r\x1b[J")
        out("chose " + choice + "\r\n")
    else:
        out("echo: " + line + "\r\nsecond line\r\n")
    out("> ")


def main():
    tty.setraw(0)
    # Like codex while its MCP servers start: a quiet banner with no input box for a while.
    slow = float(os.environ.get("FAKE_SLOW_PROMPT", "0"))
    if slow:
        out("starting servers (1/1)\r\n")
        time.sleep(slow)
    out("fake agent ready\r\n> ")
    line = ""
    while True:
        ch = sys.stdin.read(1)
        if ch == "":
            return
        if ch == "\x03":
            out("\r\n")
            return
        if ch in "\r\n":
            handle(line)
            line = ""
            continue
        line += ch
        out(ch)


main()

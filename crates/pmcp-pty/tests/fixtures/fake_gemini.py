"""Mimics the Gemini CLI 0.64 screen states pmcp-pty profiles match: tool confirmation, idle input box, busy spinner."""
import os
import sys
import termios
import time
import tty

WIDTH = 60


def box(lines):
    out = ["╭" + "─" * (WIDTH - 2) + "╮"]
    for line in lines:
        out.append("│ " + line.ljust(WIDTH - 4) + " │")
    out.append("╰" + "─" * (WIDTH - 2) + "╯")
    return out


def draw(history, body):
    sys.stdout.write("\x1b[2J\x1b[H" + "\r\n".join(history + body) + "\r\n")
    sys.stdout.flush()


def confirmation():
    return box([
        "?  Shell  rm -rf build",
        "",
        "rm -rf build",
        "",
        "Allow execution of: 'rm'?",
        "",
        "● 1. Allow once",
        "  2. Allow for this session",
        "  3. No, suggest changes (esc)",
    ])


def input_box(buffer):
    text = ">   Type your message or @path/to/file" if not buffer else "> " + buffer
    return box([text])


def read_byte():
    return os.read(0, 1)


def main():
    saved = termios.tcgetattr(0)
    tty.setraw(0)
    sys.stdout.write("\x1b[?1049h\x1b[?2004h\x1b]2;fake-gemini\x07")
    history = ["fake gemini 0.64 layout"]
    try:
        draw(history, confirmation())
        while read_byte() not in (b"\r", b"1"):
            pass
        history.append("\u2714 Shell rm -rf build (allowed once)")
        buffer = ""
        pasting = False
        pending = b""
        draw(history, input_box(buffer))
        while True:
            b = read_byte()
            if b == b"\x03":
                return 0
            if b == b"\x1b" or pending:
                pending += b
                if pending in (b"\x1b[200~", b"\x1b[201~"):
                    pasting = pending == b"\x1b[200~"
                    pending = b""
                elif len(pending) >= 6:
                    pending = b""
                continue
            if b == b"\r" and not pasting:
                for i in range(8):
                    draw(history, ["⠋ Responding (esc to cancel, %ds)" % (i // 5)] + input_box(""))
                    time.sleep(0.15)
                history.append("✦ echo: " + buffer)
                buffer = ""
                draw(history, input_box(buffer))
                continue
            buffer += b.decode("utf-8", "replace").replace("\r", " ")
            draw(history, input_box(buffer))
    finally:
        sys.stdout.write("\x1b[?2004l\x1b[?1049l")
        sys.stdout.flush()
        termios.tcsetattr(0, termios.TCSANOW, saved)


if __name__ == "__main__":
    sys.exit(main())

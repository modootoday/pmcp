# pmcp-desktop

An Xvfb desktop a coding agent sees through screenshots and drives through XTEST, served as an
MCP server on stdio. It is the Linux route to computer use for Claude Code and Codex, whose own
computer use needs a macOS or Windows desktop app.

```sh
pmcp-desktop doctor            # read-only; exact fix per missing piece; exit 0 ready, 1 missing, 2 unsupported
pmcp-desktop setup --plan      # root steps for you to run, user steps for --apply (none here)
pmcp-desktop serve [--geometry 1440x900x24] [--memory-max 512M] [--approved <dir>] [--no-scope]
```

`serve` re-runs itself once inside `systemd-run --user --scope` with `MemoryMax` (512M by
default), `MemoryHigh` at 80% and `TasksMax=256`, so Xvfb and every launched app share the cap.
It starts Xvfb on the first free display from `:90` to `:99` with `-nolisten tcp` and a random
MIT cookie in an owner-only Xauthority file under `$XDG_STATE_HOME/pmcp-plugins/desktop/`, so
other local users cannot connect. When the client closes stdin, Xvfb gets TERM (an X server
resets on HUP) and then the shared HUP-then-KILL reap, and launched apps go the same way.

| Tool | |
| --- | --- |
| `screenshot` | PNG of the screen, scaled to at most 1280 wide; other tools take coordinates in its pixels |
| `click`, `double_click`, `drag`, `scroll` | pointer input through XTEST |
| `type` | text up to 2000 characters; characters missing from the keymap (Hangul, say) are bound to a spare keycode |
| `key` | a key or chord: `Return`, `ctrl+l`, `shift+Tab`, `F5` |
| `cursor_position`, `viewer_info` | read only |
| `launch` | an app by name from `desktop.launch` in the copy you approved (`--approved`, the directory `pmcp harness host approve` writes), read at each call and used only while it matches its approval; browsers are never launched, even when listed |

No VNC viewer is started; you watch through screenshots. Tests run a real Xvfb with a
fake X client written in Rust: `cargo test -j 2`.

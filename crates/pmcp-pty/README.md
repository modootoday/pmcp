# pmcp-pty

A small PTY host for interactive coding-agent TUIs. A supervisor such as pmcp injects input
through a guard and reads screen state; a human can still attach. It exists for runtimes
with no structured channel into a running interactive session — Gemini CLI first, then
agy and grok, and Codex as a fallback while it runs under `--no-daemon`. Claude, opencode
and Codex normally use their own channels (inbox socket, HTTP, app-server).

Not a terminal multiplexer: no panes, windows, layout, copy mode, config language or web
server.

## Build and run

```sh
cargo build --release -j 2
pmcp-pty daemon [--profiles profiles.toml]
pmcp-pty call '{"op":"list"}'
pmcp-pty attach gem                             # detach: Ctrl-\ Ctrl-\
pmcp-pty profiles --profiles my-profiles.toml   # validate a profile file
```

Every command takes `--socket <path>`; without it the socket is `$PMCP_PTY_SOCKET`, else
`$XDG_RUNTIME_DIR/pmcp-pty.sock`. One daemon per user/scope. The socket path must fit `sun_path` (108 bytes on Linux), so
prefer `$XDG_RUNTIME_DIR` over deep scratch directories.

## Socket and trust model

- The socket is bound under `umask 0177` and then `chmod 0600`; an existing live socket at
  the path is an error, a stale socket file is replaced, a non-socket file is refused.
- Every connection's peer uid (`SO_PEERCRED` on Linux, `getpeereid` on BSD/macOS) must equal
  the daemon's effective uid, or the connection is dropped.
- The daemon never answers a prompt on its own. Dialogs are reported, not dismissed.
- Every request that can change a session (spawn, write, key, turn, answer, resize, kill,
  remove, attach, detach, record, event, lease, shutdown) is appended to
  `<socket>.audit.jsonl` (mode 0600, beside the socket, `.sock` replaced) with the time, the
  caller's pid and executable, the outcome, and text only as `len` and `sha256`.
- A harness lease (`lease`) makes `write`, `key`, `turn` and `answer` require its token in
  `expect.lease`; the harness grants it, pmcp-pty only holds it. A person typing through a
  writable attach wins: program input fails with `conflict` and `retry_after_ms` for five
  seconds after their last keystroke.
- `answer` chooses a dialog option only when the operator's policy lists it; without one every
  answer fails with `guard`. Login, auth (`auth-*`) and trust dialogs and `hooks-review` are
  never answered, whatever the policy says. The policy is read on every request from:
  - `daemon --host <dir>`: the copy `pmcp harness host approve` wrote (`host.json`,
    `policy.json`, `approval.json`; the directory owner-only). It loads only while the files
    match `approval.json`'s sha256 over `host.json\n<manifest>\0policy.json\n<policy>`.
    These checks run as the operator's own user: they stop accidents and instructed agents,
    not a process determined to write that directory.
  - `daemon --answers <file.toml>`: an operator-written file, owned by the daemon's user and
    not group or world writable, in the same fields:
  ```toml
  [[allow]]
  profile = "gemini"
  dialog = "tool-approval"
  options = ["Allow once"]   # option keys or labels
  ```

## API

JSON lines over the socket: one request object per line, one reply line, except
`subscribe` (a stream of event lines) and `attach` (switches to raw bytes). Every reply has
`ok`. A failure is `{ok: false, code, message, retry_after_ms?}` with `code` one of
`bad_request not_found exited busy dialog_open guard timeout lease conflict stale`. Sessions
are addressed by `id` (`s1`, `s2`, ...) or `name`.

### For AI callers

One request does one whole thing; the daemon waits, not the caller.

| op | request fields | reply |
| --- | --- | --- |
| `observe` | `id`, `lines?` (20) | `status` (`starting idle busy dialog exited`), `dialog` (`{name, prompt, options[{key,label}], selected}` or null), `input` (box text when the profile can read it), `tail_lines` (clean), `runtime`, `version`, `labels`, `pid`, `instance`, `busy`, `idle_ms`, `size`, `next` |
| `wait` | `id`, `until[]` (`idle`, `turn_end`, `dialog`, `exit`, `output`, or `{text: regex}`), `timeout_ms?` (30000) | `fired` (the condition, `timeout` or `exited`), `after_ms`, `observe` |
| `read` | `id`, `since?` (0), `max_chars?` (16000) | `text` (clean transcript lines), `next` (cursor for the next read), `gap`, `more` |
| `turn` | `id`, `text`, `timeout_ms?` (120000, counted from delivery), `wait_idle_ms?`, `expect?`, `target?` | `outcome` (`completed dialog timeout refused exited`), `completed_by` (`hook channel screen`), `stop_reason`, `receipt` (with `channel`, `fallback`), `reply`, `dialog`, `hooks_live`, `duration_ms`, `next` |
| `event` | `id`, `kind` (`session_start turn_start turn_end permission`), `message?`, `session?`, `expect?` | `seq`; sent by pmcp's hooks inside the hosted runtime |

The clean transcript is built from the rendered screen: a row is committed when it scrolls off
or stays unchanged for the profile's `settle_ms`. Spinner, busy and input-box rows, and
box-drawing borders, never enter it; a line that a redraw moves is not committed twice.

`turn` delivers through the profile's channel (below) and then takes its end from the runtime
itself before the screen, because a TUI need not draw a turn started elsewhere:

1. hook: pmcp's hooks inside the hosted runtime send `event` (they find the host through
   `PMCP_PTY_SOCKET` and `PMCP_PTY_SESSION`); a `turn_end` after delivery completes the turn
   and its message is the reply, and a `permission` event ends it as a dialog;
2. channel: a structured channel that sees its own end (the ACP prompt's `stopReason`, with
   the reply from `agent_message_chunk`);
3. screen: idle after a busy pattern or a reply line, only for a session whose hooks have
   never reported, or when they stay silent five seconds after the screen looks finished.

`completed_by` says which one ended it. On the screen path the reply is the clean text after
the echo, the first new line that holds the input, so a reply that quotes the input stays.
`wait_idle_ms` waits for idle before delivering instead of refusing busy; a dialog refuses.
The session id that the hooks report is the target for structured channels when the caller
gives none; with neither, they decline with "no target session" and the screen delivers.

`spawn` takes `labels` (map) and returns `pid` and `instance` (daemon pid and start time).
`write`, `key`, `resize`, `kill`, `turn` and `answer` take `expect: {instance?, pid?, lease?}`
and fail with `stale` when it does not match, so a stale caller never reaches a different
session. `observe` also reports `leased` and `humans` (writable attachers).

### All ops

| op | request fields | reply |
| --- | --- | --- |
| `spawn` | `argv`, `name?`, `cwd?`, `env?` (map), `cols?` (120), `rows?` (40), `profile?`, `ring_kb?` (256), `labels?` | `id`, `profile`, `pid`, `instance` |
| `list` | `labels?` (all must match) | `instance`, `sessions[]`: `id name argv profile pid alive labels` |
| `screen` | `id` | `rows[]` (plain text, right-trimmed), `cursor{row,col}`, `title`, `size{cols,rows}`, `alternate_screen`, `bracketed_paste` |
| `tail` | `id`, `bytes?` (65536), `strip?` (drop ANSI) | `text`: last bytes of the transcript ring |
| `state` | `id` | `alive exit_code signal pid idle_ms idle last_output_at input_box_empty dialog dialog_source busy profile` |
| `write` | `id`, `text`, `submit?` (false), `guard?` (`"idle"` default, or `"none"`), `wait_ms?` (1000) | receipt, see below |
| `key` | `id`, `key` | `ok` |
| `resize` | `id`, `cols`, `rows` | `ok` |
| `kill` | `id`, `signal?` (`HUP INT TERM KILL`; default is portable-pty's killer, SIGHUP on Unix) | `ok` |
| `remove` | `id` (exited sessions only) | `ok` |
| `subscribe` | `id` | `{"ok":true,"subscribed":id}` then events until exit |
| `attach` | `id`, `cols?`, `rows?`, `read_only?`, `resize?` | `{"ok":true,"attached":id,"read_only"}`, a repaint, then raw output; raw input bytes go to the PTY unless read-only |
| `attachers` | `id` | `attachers[]`: `pid` (peer credentials, Linux), `read_only`, `size`, `since` |
| `detach` | `id` | closes every attach connection; `detached` (count) |
| `record` | `id`, `label` (a-z, 0-9, -), `redact?` (true) | saves the screen, raw tail and what the profile reads into `<--fixtures dir>/<profile>/<label>/`, redacted |
| `lease` | `id`, `token?`, `ttl_ms?` (60000, at most 3600000), `current?`, `release?` | `leased`; replacing or releasing a live lease needs `current` (or the same token) |
| `answer` | `id`, `dialog` (the name on screen), `option` (key or label), `expect?` | `allowed`, `option`; `guard` unless the policy allows it |
| `describe` | | `ops[]` (`op`, `about`, `read_only`, `mcp` read/write/never, `request` as JSON Schema, from `src/describe_ops.txt`), `codes`, `profiles[]` (`name version delivery`), `policy` (`loaded`, `mcp_write`) |
| `shutdown` | | kills every session, removes the socket, exits |

A request with `"via": "mcp"` comes from `pmcp harness mcp`, and the daemon limits it itself:
`describe list observe wait read` pass; `turn` and `lease` only when the operator policy file
sets `mcp_write = true`; everything else, `answer` included, fails with `guard`. Over MCP even
reads are audited, marked `via: mcp`. The tag is the server's own declaration, not an identity:
the caller's pid and executable in the audit are.

A sized attach (`pmcp-pty attach` sends its terminal size) resizes the session while it is
attached; the size from before the first sized attach returns when the last one leaves.
`--read-only` reads and drops the attacher's keystrokes, and a read-only attach does not
resize unless it sends `resize: true`, so a viewer never reflows a session someone drives. `record` writes only under the
directory given to `daemon --fixtures`, never one named in a request.

Every spawned child gets `PMCP_PTY_SOCKET`, `PMCP_PTY_SESSION` (its id) and
`PMCP_PTY_INSTANCE`, set after the request's `env` so a request cannot forge them.

A child does not inherit the session identity of whatever started the daemon. Removed unless
named in the spawn's `keep_env` or set in its `env`: `AI_AGENT CLAUDECODE CLAUDE_EFFORT
CLAUDE_PID CODEX_SANDBOX CODEX_SANDBOX_NETWORK_DISABLED GEMINI_CLI` and every name starting
`CLAUDE_CODE_CHILD CLAUDE_CODE_ENTRYPOINT CLAUDE_CODE_EXECPATH CLAUDE_CODE_MESSAGING_
CLAUDE_CODE_SESSION CLAUDE_CODE_SSE_PORT CODEX_SESSION CODEX_THREAD GROK_SESSION ANTIGRAVITY_
OPENCODE_PID OPENCODE_SERVER_ OPENCODE_SESSION PMCP_PTY_`. The spawn reply lists the removed
names in `scrubbed` (never values). Live, a Claude hosted from a Claude session took
`CLAUDE_CODE_CHILD_SESSION`, saved no transcript and wrote no session file.

`kill` without a signal and `shutdown` send HUP to each session's process group and tree, KILL
what is left after two seconds (the tree walked again, for children started meanwhile), and
`shutdown` replies only when every one of those processes is gone.

### Delivery channels

`turn` tries the profile's `delivery` first and falls back to the screen with guard idle; the
receipt names the `channel` and every `fallback` reason. A structured channel is skipped while
a dialog is on screen. The caller passes what only it knows as `target: {session, remote, url}`
(the runtime's own session or thread id, from pmcp's registry).

| delivery | how | needs |
| --- | --- | --- |
| `claude-inbox` | one NDJSON user line to `messagingSocketPath` from `~/.claude/sessions/<pid>.json` of the spawned pid (read only) | nothing; a bypassPermissions target holds it for approval |
| `http-prompt-async` | `POST /session/<id>/prompt_async` on loopback, basic auth from the spawn env's `OPENCODE_SERVER_PASSWORD` | spawn with `delivery_setup` (pins `--port`); the session the TUI shows (`target.session`, or the one its hooks reported) |
| `codex-queue` | `codex queue --remote <addr> --thread <id> --message <text>` | spawn with `delivery_setup`, or an explicit `target.remote`; `target.session` (the thread id), else the hook-reported one, else, only on the session's own private app-server, its one loaded thread from `thread/loaded/list` (receipt `thread_from`; none or several declines to the screen) |
| `grok-leader-acp` | an ACP client on the session's leader: `initialize`, `session/prompt`; on -32602, `session/load` and one retry; permission requests are never answered | spawn with `delivery_setup` (the session's own leader); `target.session` or the hook-reported one |
| `screen` | guarded write and submit | nothing |

`delivery_setup: true` on `spawn` launches the runtime so its channel works, with every piece
inside the session's own process tree (and so inside any systemd scope around the launch).
Codex gets a private app-server (`codex app-server --listen unix://<dir>/codex.sock`, the TUI
with `--remote` to it) instead of the shared daemon, whose work would escape the session's
scope. grok gets its own leader (`grok agent leader --leader-socket <dir>/grok-leader.sock
--relay-on-demand`, the TUI with `--leader --leader-socket` to it) instead of one the TUI spawns
detached, which outlived its TUI live and ignored SIGTERM. When the TUI exits, the helper gets
HUP and, two seconds later, KILL. A helper's stdout and stderr go to `<dir>/helper.log`, never
the PTY: live, the app-server's MCP OAuth errors were painted over the TUI. `<dir>` is
`<socket dir>/pmcp-pty.d/<instance>/<id>`, mode 0700. The spawn reply shows `channel`.

`last_output_at` is RFC 3339 UTC. `idle` is `idle_ms >= profile.idle_ms`. `input_box_empty`
is `null` when the profile has no input pattern or a dialog is on screen.

### write and its receipt

1. With `guard: "idle"` the write is refused (`accepted: false`, `reason`) when the session
   has exited, a profile dialog is on screen, a busy pattern matches, output is younger than
   the profile's `idle_ms`, or the profile can tell the input box is not empty.
2. `text` loses every control character except newline and tab (so it can never contain
   ESC, end the paste or act as a key), newlines become CR as a terminal paste would, and it
   is wrapped in bracketed paste when the application has enabled mode 2004. If it has not,
   multi-line text is refused; single-line text is typed raw.
3. With `submit: true` pmcp-pty waits `submit_delay_ms`, re-checks for a dialog (guard
   `idle` only), then sends one CR.
4. The receipt: `{accepted, bytes, paste: "bracketed"|"raw", submitted, submit_refused,
   screen_changed_within_ms}`; the last is `null` when the rendered text did not change
   within `wait_ms`.

Named keys are only sent by `key`, never by `write`: `Enter Escape Tab BTab Backspace Space
Up Down Left Right` (arrows follow the application-cursor mode), `C-a` .. `C-z`, and a
single ASCII letter or digit (menu shortcuts such as `1`). Keys are not guarded: answering
a dialog is a deliberate supervisor act.

### subscribe events

`output-idle {idle_ms}`, `output-active`, `dialog-appeared {dialog, source}`,
`dialog-cleared {dialog}`, `exit {exit_code, signal}`. The daemon samples every 100 ms and
wakes exactly at the idle threshold, so a dialog shown for less than 100 ms can be missed.

## Profiles

`profiles.toml` (built into the binary; override with `--profiles` or `PMCP_PTY_PROFILES`).
A profile is picked by `spawn.profile`, else by the basename of `argv[0]` against `argv0`,
else `default`.

```toml
[profiles.gemini]
argv0 = ["gemini"]
idle_ms = 1500          # quiet time before output counts as idle
submit_delay_ms = 120   # pause between paste and Enter

[[profiles.gemini.dialogs]]   # also: busy, input_empty, spinner
name = "tool-confirm-exec"
regex = 'Allow execution of'
source = "gemini-cli 0.64.0 bundle/interactiveCli-66E5CZDR.js:12228,12305"
```

Optional fields: `settle_ms` (400), `spinner` (rows dropped from the transcript, like busy
rows), `input` (one pattern whose named group `text` reads the input box; an `input_empty`
match wins, so a dim placeholder is never read as a draft), `version` (the runtime version
the patterns were read from) and `delivery` (the turn channel). Dialog names starting with
`auth-` are login prompts; nothing may ever answer them.

Regexes run against the rendered screen, rows joined with newlines. Each pattern names its
`source`: a file and line, a byte offset (`@n`) in a binary, or a live capture. All six
profiles were read from the installed builds on 2026-10-20: claude 2.1.304, codex-cli 0.163.0,
gemini-cli 0.64.0, agy 1.4.3, grok 1.0.62 and opencode 1.18.33. Strings not yet seen on a live
screen say "unverified" in their source.

At spawn, a profile with a `version` runs `<argv0> --version` once; `observe` reports
`version`, `profile_version` and a `version_warning` when they differ.

Dialog options come in three shapes, reported as `select`: `number` (`● 1. Allow once`),
`letter` (grok's `y  Yes, proceed`) and `arrows` (agy's `> Yes, I trust this folder` over
`  No, exit`, keyed by position). Claude's question dialog has its options above the matched
hint row; the parser looks above when nothing follows the prompt.

### Fixtures

`fixtures/<runtime>/<label>/screen.txt` are synthetic screens: each runtime's chrome (borders,
footers, dialog and spinner rows) rebuilt by hand with neutral text, no paths, ids or real
messages. `meta.json` says `synthetic` and names the live capture or binary strings it
mirrors. `expect.json` holds what the profile reads. `pmcp-pty profiles --check fixtures`
replays them (a test runs it), so a profile change that misreads a known screen fails CI.

`record` saves a screen from a running session into the daemon's `--fixtures` directory and
redacts it by default: the home directory becomes `~`, and emails, `user@host` strings and
UUIDs become placeholders (`redact: false` keeps them). A recorded screen is still a private
transcript until a person has reviewed it: rebuild it as a synthetic fixture before anything
goes into this package. `--check --seed` writes a missing `expect.json` for that review.

## Limits

- A guard check and the write that follows are not atomic; output arriving in between is
  caught only by the dialog re-check before Enter.
- Screen matching is only as good as the profile. An unknown dialog is invisible, and
  `idle` then only means "quiet".
- Sessions do not survive a daemon restart; there is no persistence or re-attach to orphans.
- Attachers share one PTY size: the latest sized attach wins until the last one leaves, and a
  terminal resized while attached is not followed.
- A turn's reply is read from the screen for every channel, so it is only as clean as the
  profile's spinner and input patterns.
- After a detach, the attacher's writer thread lingers until the session next prints.
- No scrollback beyond the screen; history is the `tail` ring (256 KB default).
- `write` text is sanitized, so a literal ESC cannot be typed through it; use `key`.

## Windows

The code is cfg-gated and builds on Linux; Windows is untested. On Windows the socket uses
`uds_windows` (AF_UNIX, Windows 10 1803+), PTYs come from portable-pty's ConPTY backend,
there is no peer-credential check (protect the socket directory with an ACL), `kill`
ignores `signal` and terminates the process, and `attach` reports that console raw mode is not
implemented.

## Comparison

From each project's documentation; none of them is installed here, so nothing below was
run.

| need | pmcp-pty | tmux | wezterm mux | zellij |
| --- | --- | --- | --- | --- |
| send text | `write`, bracketed paste when the app enabled it, control bytes stripped | `send-keys -l` (literal) or `load-buffer` + `paste-buffer -p` (bracketed when requested) | `wezterm cli send-text` (bracketed paste by default, `--no-paste` raw) | `zellij action write-chars` (typed), `write` (bytes) |
| refuse when a dialog or busy | yes, profile regexes, returns the reason | X (script it around `capture-pane`) | X | X |
| write receipt | `screen_changed_within_ms` | X | X | X |
| read screen | `screen` (rows, cursor, title, modes as JSON) | `capture-pane -p` (`-e` escapes, `-S` history) | `wezterm cli get-text` (`--escapes`, line ranges) | `zellij action dump-screen <file>` (`--full` scrollback) |
| idle / exit events | `subscribe` | `monitor-silence`, hooks, control mode `%output` | Lua events in config | WASM plugin events |
| human attach | `pmcp-pty attach`, many clients | native, many clients | GUI or `wezterm connect` | native |
| access control | 0600 socket and peer uid check | per-uid socket dir, socket mode | unix domain mux socket | per-user session sockets |
| Windows | ConPTY path, untested | X (WSL/Cygwin only) | yes | X |
| size | about 1,430 lines of Rust without tests, one binary | large C codebase | full GPU terminal | large Rust codebase, WASM runtime |

What pmcp-pty adds is the guard: a supervisor write is refused, with the reason, while the
target shows a known dialog, is busy, has output that is not yet idle, or has typed input.
Any of the three multiplexers could host the TUI, but each leaves that decision to a
polling script outside them.

## Tests

```sh
cargo test -j 2
```

Unit tests cover the profile matcher (gemini dialog, trust, busy and placeholder strings,
argv0 selection, bad regex), the guard, the input encoder (paste wrapping, escape
smuggling, keys), the ring and ANSI strip, timestamps and the detach filter, plus the clean
transcript, dialog option parsing, error codes and the wire types. The integration tests start
the daemon on a temporary socket and drive `bash`, `tests/fixtures/fake_gemini.py` (Gemini's
tool-confirmation box, idle input box and busy timer) and `tests/fixtures/fake_agent.py` with
`tests/fixtures/fake.toml` (input line, user echo, spinner, numbered dialog, a reply that
quotes the input, exit), which covers observe, wait, read, turn, labels and expect. They need
`bash` and `python3` on PATH; no real agent runs.

## Library

The crate is also a library, `pmcp_pty`, for other crates such as a TUI: `proto` (every
request type, serializable both ways), `error` (codes), and `client::request` for one request
and one reply. `client::attach_stream` returns an attached session as a plain byte stream (the
repaint, then raw output; writes go to the PTY), so a TUI pane can embed it, not only a
terminal.

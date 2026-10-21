# pmcp-browser

An isolated Chromium a coding agent drives through MCP on stdio: public http(s) sites only, a
fresh profile per launch, the Chromium sandbox on, and an address policy Chromium cannot step
around.

```sh
pmcp-browser doctor            # read-only; pinned Chromium, sandbox, fonts, headed-mode policy
pmcp-browser setup --plan      # root steps for you to run; the managed policy and its sha256
pmcp-browser setup --apply     # user level only: adopt the matching Playwright build as a symlink
pmcp-browser serve [--memory-max 2G] [--approved <dir>] [--display :N --xauthority <file>] [--no-scope]
```

- **Scope and slots.** `serve` re-runs itself in `systemd-run --user --scope` (2G, MemoryHigh 80%,
  TasksMax 1024). Each MCP client starts its own `pmcp-browser`; at most two hold the host-wide
  slots (`flock` on `$XDG_STATE_HOME/pmcp-plugins/browser/slot-{1,2}.lock`), and a third exits at
  once naming the holders.
- **Chromium.** The pinned build is Chrome for Testing 153.0.8010.12 (Playwright chromium-1243),
  checked by the SHA-256 of its `chrome` binary; another binary is refused. It starts on the
  first page tool, headless, with a new profile directory that `close` deletes. A Chromium
  killed under memory pressure is reported once, and the next call starts a fresh one.
- **Address policy.** Chromium sends everything, loopback included, through the plugin's own
  proxy on 127.0.0.1. The proxy resolves each host once, refuses loopback, RFC 1918,
  link-local and metadata, CGNAT, reserved and IPv6 local or mapped-private addresses, opens only
  ports 80 and 443 to public hosts, and connects to the address it checked. Private
  `host:port` entries come only from `browser.allow_private` in the copy you approved
  (`--approved`). WebRTC is kept to the proxy and DNS prefetch is off.
- **Local schemes.** `navigate` opens only http and https. Every page blocks `file:`,
  `chrome:`, `chrome-extension:`, `devtools:`, `view-source:`, `javascript:`, `blob:` and
  `ftp:` through CDP. Headed mode on pmcp-desktop's display is refused until the managed policy
  (`policy/pmcp-browser.json`, URLBlocklist and no sign-in, sync, passwords or extensions) is
  installed by you, since a desktop can type into the address bar.
- **Downloads** go to a per-process directory; past 512 MiB the browser refuses more.

| Tool                                               |                                                               |
| -------------------------------------------------- | ------------------------------------------------------------- |
| `navigate`, `tabs`, `close`                        | open a URL; list, open, select or close tabs; end the browser |
| `snapshot`                                         | the accessibility tree with a ref on each control             |
| `click`, `type`, `press`                           | by ref, CSS selector or viewport point; key chords            |
| `read_text`, `screenshot`, `wait_for`, `downloads` | read only                                                     |

Tests run the pinned Chromium headless against local servers, one approved and one not:
`cargo test -j 2`.

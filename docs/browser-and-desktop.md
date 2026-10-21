# Browser and desktop for agents

[Back to the overview](../README.md)

pmcp-browser and pmcp-desktop give agents a browser and a desktop on a Linux server, as MCP
servers. What they may reach is set in `[host]` of the [pmcp.toml reference](project-configuration.md#sessions-pmcp-pty-hosts).

Claude Code and Codex offer browser and computer use only through their
desktop apps, not on a Linux server. Two MCP servers built from this
repository cover that ground for every runtime pmcp projects to:

- `pmcp-browser` (`crates/pmcp-plugin-browser-use`): an isolated Chromium,
  headless, with a fresh profile per launch. It reaches public http(s) sites
  only: every request goes through its own proxy, which refuses loopback,
  private, link-local, metadata and CGNAT addresses and every port but 80 and 443. Local schemes such as `file:` are blocked in the page.
- `pmcp-desktop` (`crates/pmcp-plugin-computer-use`): an Xvfb desktop driven
  through screenshots and XTEST input, for any X11 app.

Each runs in its own memory-capped systemd scope (2G and 512M by default),
and `pmcp-browser` allows two at a time on the host. Both have `doctor`
(read-only, with the exact fix) and `setup --plan`; root steps are printed,
never run. Both ship in the Linux platform package npm installs with PMCP
(glibc 2.35 or later), which does not put them on PATH. Declare them like
any MCP server with the bare name as `command`; `pmcp project` resolves it to
the installed binary, so pmcp.toml names no host path:

```toml
[mcp.pmcp-browser]
command = "pmcp-browser"
args = ["serve", "--approved", "<the directory pmcp harness host status reports>"]

[mcp.pmcp-desktop]
command = "pmcp-desktop"
args = ["serve", "--geometry", "1440x900x24"]
```

`pmcp doctor` reports where each resolved, or why not (no platform
package for this host, as on macOS); an unresolved name runs from PATH. An
absolute `command`, such as your own build, is kept as written.

The names avoid Claude Code's built-in `computer-use`. `--approved` is
optional: without it the browser is public-only and the desktop launches
nothing. `[host.browser] allow_private` and `[[host.desktop.launch]]` come
into force only through `pmcp harness host approve`. Running the browser
headed on the desktop's display also needs the managed Chromium policy that
`pmcp-browser setup --plan` prints for you to install.

# Security

Please report a vulnerability privately through GitHub's security advisory form:

<https://github.com/modootoday/pmcp/security/advisories/new>

Do not open a public issue for a vulnerability or include credentials, private
package names, dependency inventories, OAuth tokens, registry tokens, or private
repository details in a report that other people can read.

## Boundaries

The MCP server reads installed package manifests and `SKILL.md` files locally.
It must not send dependency inventories or search queries over the network.
Network access belongs to explicit CLI commands such as catalog retrieval,
authentication, installation, and synchronization.

Package installation changes a project manifest and lockfile through npm, Bun or pnpm.
Inspect the plan with `--dry-run`; non-interactive application requires `--yes`.
The CLI disables dependency install scripts for skill-package installation and
checks catalog integrity against registry metadata before applying a plan.

The server returns skill files as text or base64 and never runs them. An MCP config
(`.mcp.json`) is served with every `env` and `headers` value redacted. The HTTP handler
refuses browser origins it was not given, and caps request size; host names and a
per-caller rate limit are options. Authentication and call records belong to the host.

The optional parts that act on your machine run as your own user:

- The [hook bundle](docs/hooks.md) refuses risky commands and edits for the runtimes it
  targets. Guards fail closed; a bundle that cannot load fails open. It stops accidents and
  agents that were told to do something unsafe; it does not replace the runtime's own sandbox.
- [pmcp-browser](docs/browser-and-desktop.md) sends every request through its own proxy,
  which refuses loopback, private, link-local, metadata and CGNAT addresses and ports other
  than 80 and 443, and starts each Chromium with a fresh profile. Page content reaches the
  agent as data, not instructions.
- [pmcp-desktop](docs/browser-and-desktop.md) launches only the apps an approved policy
  lists, never a browser.
- A [`[host]` policy](docs/project-configuration.md#sessions-pmcp-pty-hosts) takes effect
  only after you approve it in your own terminal, and login, auth, trust and hook-review
  dialogs are never answered. The approval check stops accidents, not a process running as
  you, which can write the approvals directory; that guide says what a real boundary needs.

## Supported versions

Security fixes are released on the latest published version. Include the pmcp
version, runtime version, package manager, operating system, and a minimal
reproduction that contains no private project data.

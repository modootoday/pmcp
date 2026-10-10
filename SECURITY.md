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

Package installation changes a project manifest and lockfile through npm or Bun.
Inspect the plan with `--dry-run`; non-interactive application requires `--yes`.
The CLI disables dependency install scripts for skill-package installation and
checks catalog integrity against registry metadata before applying a plan.

The server returns skill files as text or base64 and never runs them. An MCP config
(`.mcp.json`) is served with every `env` and `headers` value redacted. The HTTP handler
refuses browser origins it was not given, and caps request size; host names and a
per-caller rate limit are options. Authentication and call records belong to the host.

## Supported versions

Security fixes are released on the latest published version. Include the pmcp
version, runtime version, package manager, operating system, and a minimal
reproduction that contains no private project data.

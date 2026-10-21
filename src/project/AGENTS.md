# Project projection invariants

Follow the [package rules](../../AGENTS.md).

- Keep native projection deterministic and preserve unmanaged configuration and trust requirements.
- Validate declarations before writing outputs and track ownership through the existing project lock.
- Keep MCP specification parsing separate from native projection and credential handling.
- Preserve native MCP authentication by default; proxy only explicitly opted-in remote servers.
- Never project credential values or copy native authentication profiles into the project.
- Keep command entries thin and domain logic behind their feature modules.

# Mailbox rules

- Follow the package contributor rules in ../../AGENTS.md.
- Keep authentication, transaction serialization, message visibility and recovery separate.
- Preserve credential validation, SQL ordering and transaction boundaries during refactors.
- Keep entry modules limited to assembling public exports.
- Keep provider authentication and MCP server setup outside mailbox storage.

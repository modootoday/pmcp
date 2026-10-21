# normal

Create a marketplace `acme` with one plugin `billing-skills` that holds the skill `invoice-dispute` and an MCP server `ledger` (`command: ledger-mcp`). pmcp must list both.

## PASS

- Writes `.claude-plugin/marketplace.json` with the plugin's `name` and `source`, and the tier under `metadata`.
- Puts the skill at `plugins/billing-skills/skills/invoice-dispute/SKILL.md` with a description, and the server in `plugins/billing-skills/.mcp.json`.
- Gives plugin.json a description so the MCP entry has one, and checks the result with `pmcp list`.

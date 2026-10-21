// One line per built-in skill for the /examples/ list. A skill's description is written for an
// agent deciding whether to load it, and is too long for a list; the build fails without a line.
export const summaries = {
  "agent-assets-migrate":
    "Move scattered agent files into AGENTS.md, .agents/ and pmcp.toml without losing a line.",
  "headless-agents-ci-scaffold":
    "Run agent CLIs headless in CI with the permission setting each one actually honours.",
  "marketplace-plugin-scaffold":
    "Lay out a plugin marketplace so pmcp lists every skill, agent, hook and MCP server.",
  "package-skill-catalog":
    "Find, check and load the right skill from a pmcp catalog instead of guessing.",
  "pmcp-browser":
    "Browse public websites from a Linux host through the pmcp-browser MCP server.",
  "pmcp-desktop":
    "Use an X11 desktop on a Linux host through the pmcp-desktop MCP server.",
  "pmcp-project-init":
    "Set up a repository so every coding agent reads the same instructions and servers.",
  "pmcp-sessions-and-git":
    "Work alongside other agent sessions: leases, linked worktrees and one delivery path.",
  "skill-package-scaffold":
    "Lay out one skill folder that passes the Agent Skills specification, with eval cases.",
};

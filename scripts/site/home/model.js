export const runtimes = [
  { id: "claude", name: "Claude" },
  { id: "codex", name: "Codex" },
  { id: "gemini", name: "Gemini" },
  { id: "grok", name: "Grok Build" },
  { id: "antigravity", name: "Antigravity" },
];

export const features = [
  {
    id: "skills",
    label: "Skill discovery",
    scope: "Core",
    title: "Find instructions that fit the task.",
    description:
      "Search workspace and plugin skills. Read a SKILL.md before using it. Lexical discovery works without a model download.",
    code: "skill_find → skill_read\n\nTask: review release readiness\nSource: workspace or plugin catalog",
    guide: "guide/",
  },
  {
    id: "config",
    label: "Shared configuration",
    scope: "Core",
    title: "One source. Native tool settings.",
    description:
      "Keep shared MCP configuration in pmcp.toml. Project it to supported native formats, preserve unmanaged settings, and surface ownership conflicts.",
    code: "npx @modootoday/pmcp project\nnpx @modootoday/pmcp project --check\nnpx @modootoday/pmcp doctor",
    guide: "project-configuration/",
  },
  {
    id: "mailbox",
    label: "Mailbox",
    scope: "Optional",
    title: "Coordinate without sharing a conversation.",
    description:
      "Give sessions a shared message layer. Enable mailbox explicitly when workers need to exchange task updates. Each runtime keeps its own conversation.",
    code: "main → worker: inspect configuration\nworker → main: review ready\n\nIllustrative message flow",
    guide: "mailbox/",
  },
  {
    id: "harness",
    label: "Session harness + TUI",
    scope: "Optional / Linux",
    title: "A shared view of native sessions.",
    description:
      "Use the optional CLI host for owned session management, then a TUI for visibility and explicit control. Native trust and approval prompts remain with the runtime.",
    code: "Native runtime → owned tmux session\nCLI host → session management\nTUI → shared view\n\nRequires documented Linux setup",
    guide: "terminal-harness/",
  },
  {
    id: "embeddings",
    label: "Embedding models",
    scope: "Optional",
    title: "Choose when semantic search helps.",
    description:
      "Keep lexical search as the lightweight default. Add the optional embedding dependency and select a supported model when semantic matching is useful.",
    code: "Lexical discovery: no model required\nSemantic discovery: optional model\n\nReview model size and runtime requirements",
    guide: "embeddings/",
  },
  {
    id: "hosting",
    label: "HTTP integration",
    scope: "Library API",
    title: "Bring the discovery layer to your app.",
    description:
      "Use the library API for HTTP integration. Keep the public package boundary, catalog delivery, and your application’s access controls explicit.",
    code: "Application\n  → PMCP library API\n  → skill catalog\n\nReview licensing for hosted offerings",
    guide: "hosting/",
  },
];

export function projectConfiguration(runtimeId) {
  return [
    "[targets]",
    `tools = ["${runtimeId}"]`,
    "",
    "[catalog]",
    'workspaces = ["."]',
    "",
    "[mcp.skills]",
    'command = "node"',
    'args = ["${PROJECT_ROOT}/node_modules/@modootoday/pmcp/dist/cli.js", "serve"]',
  ].join("\n");
}

export function installationSteps(runtimeId) {
  return [
    {
      file: "Terminal / project root",
      code: "npm install --save-dev @modootoday/pmcp",
      note: "Use Node.js 22+ or Bun 1.3+. Keep your runtime’s existing authentication.",
    },
    {
      file: "pmcp.toml / project root",
      code: projectConfiguration(runtimeId),
      note: "Choose the targets you actually use. Add the shared configuration to your project.",
    },
    {
      file: "Terminal / project root",
      code: "npx @modootoday/pmcp project\nnpx @modootoday/pmcp project --check\nnpx @modootoday/pmcp doctor",
      note: "Review projection output and ownership conflicts. doctor reports configuration status.",
    },
  ];
}

// Pin the tool names so a typo cannot become a rule Claude silently never matches.
const TOOLS = new Set([
  "Agent",
  "Bash",
  "Edit",
  "Glob",
  "Grep",
  "LS",
  "MultiEdit",
  "NotebookEdit",
  "NotebookRead",
  "Read",
  "Skill",
  "Task",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
  "Write",
]);
const BARE_ONLY = new Set(["TodoWrite", "WebSearch"]);
const RULE = /^(?<tool>[A-Za-z]+)(?:\((?<specifier>.+)\))?$/su;
const MCP = /^mcp__[A-Za-z0-9][A-Za-z0-9_-]*(?:__\*)?$/u;

function specifierFits(tool: string, specifier: string): boolean {
  if (BARE_ONLY.has(tool)) return false;
  if (tool === "WebFetch") return /^domain:\S+$/u.test(specifier);
  if (tool !== "Bash") return true;
  const prefix = specifier.indexOf(":*");
  return prefix === -1 || prefix === specifier.length - 2;
}

// Check structure only and keep the expression verbatim, so native matching stays Claude's own.
export function isClaudeRule(expression: string): boolean {
  if (MCP.test(expression)) return true;
  const match = RULE.exec(expression);
  const tool = match?.groups?.["tool"];
  if (tool === undefined || !TOOLS.has(tool)) return false;
  const specifier = match?.groups?.["specifier"];
  if (specifier === undefined) return true;
  return specifierFits(tool, specifier);
}

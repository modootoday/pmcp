import { expect, it } from "vitest";
import { mcpOutputs } from "../src/project/mcp.js";
import { TOOLS, type ProjectSpec } from "../src/project/spec.js";

it("projects canonical launcher runtime metadata without embedding actor secrets", () => {
  const spec: ProjectSpec = {
    root: "/project",
    tools: new Set(TOOLS),
    skills: {},
    agents: {},
    packageRules: null,
    mcp: {
      mailbox: {
        mailbox: true,
        command: "node",
        args: ["/installed/pmcp/dist/cli.js"],
        env: { PMCP_MAILBOX_ACTOR_FILE: "/private/actor.json" },
      },
    },
  };
  const outputs = mcpOutputs(spec);
  expect(outputs).toHaveLength(6);
  const text = JSON.stringify(outputs);
  for (const runtime of [
    "codex-cli",
    "claude-code",
    "gemini-cli",
    "grok-cli",
    "antigravity",
  ]) {
    expect(text).toContain(runtime);
  }
  expect(text).toContain("PMCP_MAILBOX_ACTOR_FILE");
  expect(text).not.toContain('"secret"');
  const ordinary = mcpOutputs({
    ...spec,
    mcp: { mailbox: { ...spec.mcp.mailbox!, mailbox: false } },
  });
  expect(JSON.stringify(ordinary)).not.toContain("PMCP_MAILBOX_RUNTIME");
});

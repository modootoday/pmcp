import { expect, it } from "vitest";

import type { CommandContext } from "../src/cli/command.js";
import { renderStatus } from "../src/status/render.js";

it("names linked worktrees as worktrees in the status summary", () => {
  const lines: string[] = [];
  const context = { ui: { line: (text: string) => lines.push(text) } };
  const report = {
    config: "pmcp.toml",
    features: [],
    projection: { drift: false, problems: [], outputs: 0 },
    sessions: { live: [], pause: null, leases: [], broadcasts: [] },
    worktrees: [{ behind: 1 }, { behind: 0, ahead: 0 }],
    mcp: [],
    errors: [],
  };
  renderStatus(
    context as unknown as CommandContext,
    report as unknown as Parameters<typeof renderStatus>[1],
  );
  expect(lines).toContain("Linked worktrees: 2; 1 ahead/behind");
  expect(lines.join("\n")).not.toMatch(/desk/iu);
});

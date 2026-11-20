import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearExternalCache,
  externalPolicy,
} from "../../src/hooks/policies/external.js";
import { gitProbe } from "../../src/hooks/policies/git-probe.js";
import { createLogger } from "../../src/logging/logger.js";
import { DEFAULT_LOG_SETTINGS } from "../../src/logging/settings.js";
import { createFilesStore } from "../../src/sessions/files-store.js";

const dirs: string[] = [];

afterEach(() => {
  clearExternalCache();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("external guard content-hash cache", () => {
  it("reuses cached result for identical content and re-runs on content change", () => {
    const root = mkdtempSync(join(tmpdir(), "pmcp-ext-cache-"));
    dirs.push(root);
    const counter = join(root, "count.txt");
    const checker = join(root, "checker.mjs");
    writeFileSync(counter, "0");
    writeFileSync(
      checker,
      `import { readFileSync, writeFileSync } from "node:fs";
const n = Number(readFileSync(${JSON.stringify(counter)}, "utf8")) + 1;
writeFileSync(${JSON.stringify(counter)}, String(n));
process.exit(0);
`,
    );

    const policy = externalPolicy({
      name: "count-check",
      paths: ["AGENTS.md"],
      command: [process.execPath, checker],
      timeoutMs: 5000,
      mode: "deny",
      stdin: true,
    });
    const ctx = {
      options: {},
      mode: "deny" as const,
      store: createFilesStore(join(root, "state")),
      git: gitProbe,
      log: createLogger(() => {}, DEFAULT_LOG_SETTINGS),
      now: () => Date.now(),
    };

    const makeInput = (content: string) => ({
      contract: 2 as const,
      runtime: "claude" as const,
      event: "before_tool" as const,
      session: { id: "s1" },
      cwd: root,
      projectRoot: root,
      tool: {
        kind: "edit" as const,
        native: "Write",
        paths: [join(root, "AGENTS.md")],
        edit: { path: join(root, "AGENTS.md"), content },
      },
    });

    policy.evaluate(makeInput("same body\n"), ctx);
    policy.evaluate(makeInput("same body\n"), ctx);
    expect(Number(readFileSync(counter, "utf8"))).toBe(1);

    policy.evaluate(makeInput("changed body\n"), ctx);
    expect(Number(readFileSync(counter, "utf8"))).toBe(2);
  });
});

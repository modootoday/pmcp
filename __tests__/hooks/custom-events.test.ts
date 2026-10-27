import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, type TestContext } from "vitest";

import { readConfig } from "../../src/config.js";
import {
  legacyEntries,
  pinnedEntries,
  readCustom,
} from "../../src/hooks/compile/custom.js";
import type { HookInput, NeutralEvent } from "../../src/hooks/contract.js";
import { versionMatches } from "../../src/hooks/policies/custom.js";
import { project as projectFiles } from "../../src/project/apply.js";
import { readSpec } from "../../src/project/spec.js";
import { compiled, decide } from "./helpers.js";

// A project whose guard script records its request and prints the reply given.
function project(t: TestContext, reply: unknown): string {
  const root = mkdtempSync(join(tmpdir(), "pmcp-custom-events-"));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".agents/guards"), { recursive: true });
  writeFileSync(
    join(root, ".agents/guards/guard.sh"),
    `cat > "${join(root, "request.json")}"\necho '${JSON.stringify(reply)}'\n`,
  );
  return root;
}

function input(root: string, event: NeutralEvent): HookInput {
  return {
    contract: 2,
    runtime: "claude",
    event,
    session: { id: "abcd1234-session" },
    cwd: root,
    projectRoot: root,
    ...(event === "prompt" ? { prompt: "ship it" } : {}),
    ...(event === "stop" ? { stop: { active: false } } : {}),
  };
}

async function run(
  root: string,
  on: string,
  event: NeutralEvent,
  extra: Record<string, unknown> = {},
) {
  const entries = readCustom(
    root,
    {},
    {
      custom: [
        {
          name: "guard",
          command: ["sh", ".agents/guards/guard.sh"],
          targets: ["claude"],
          timeout_ms: 60000,
          on,
          ...extra,
        },
      ],
    },
  );
  const custom = pinnedEntries(root, entries, ["claude"]);
  return decide(input(root, event), compiled([], { custom }));
}

const request = (root: string) =>
  JSON.parse(readFileSync(join(root, "request.json"), "utf8"));

describe("custom guards on stop, session_start and prompt", () => {
  it("runs on prompt with the pmcp.guard.v1 request and the prompt, and its refusal stands", async (t) => {
    const root = project(t, { decision: "deny", reason: "not yet" });
    expect(await run(root, "prompt", "prompt")).toMatchObject({
      verdict: "deny",
      reason: "not yet",
    });
    expect(request(root)).toMatchObject({
      protocol: "pmcp.guard.v1",
      event: "prompt",
      session: "abcd1234-session",
      prompt: "ship it",
    });
  });

  it("runs on stop, where a refusal is the runtime's to render", async (t) => {
    const root = project(t, { decision: "deny", reason: "tests are red" });
    expect((await run(root, "stop", "stop")).verdict).toBe("deny");
    expect(request(root).event).toBe("stop");
  });

  it("tells the session at session_start instead of refusing it", async (t) => {
    const root = project(t, { decision: "deny", reason: "stale checkout" });
    const decision = await run(root, "session_start", "session_start");
    expect(decision.verdict).toBeUndefined();
    expect(decision.context).toEqual(["pmcp custom.guard: stale checkout"]);
  });

  it("does not run on another event", async (t) => {
    const root = project(t, { decision: "deny", reason: "x" });
    expect((await run(root, "stop", "prompt")).verdict).toBeUndefined();
  });
});

describe("the pmcp.guard.v1 reply", () => {
  it("adds findings to a refusal and turns findings on an allow into a note", async (t) => {
    const refusing = project(t, {
      protocol: "pmcp.guard.v1",
      decision: "deny",
      reason: "2 problems",
      findings: [
        { path: "src/a.ts", line: 3, message: "no default export" },
        { message: "lockfile out of date" },
      ],
    });
    expect(
      (await run(refusing, "before_shell", "prompt")).verdict,
    ).toBeUndefined();
    expect((await run(refusing, "prompt", "prompt")).reason).toBe(
      "2 problems\nsrc/a.ts:3: no default export\nlockfile out of date",
    );
    const allowing = project(t, {
      decision: "allow",
      findings: [{ path: "README.md", message: "long line" }],
    });
    expect(await run(allowing, "prompt", "prompt")).toEqual({
      context: ["pmcp custom.guard:\nREADME.md: long line"],
    });
  });

  it("treats a malformed reply as a failed guard", async (t) => {
    for (const reply of [
      { decision: "deny", findings: [{ line: 2 }] },
      { decision: "allow", protocol: "pmcp.guard.v9" },
      { decision: "allow", extra: true },
    ]) {
      const root = project(t, reply);
      expect((await run(root, "prompt", "prompt")).reason).toBe(
        "Guard failed validation or execution",
      );
    }
  });
});

describe("an installed program as a custom guard", () => {
  const nodeVersion = process.version.slice(1);
  const program = (version: string) => ({
    name: "tool",
    command: [
      "node",
      "-e",
      'process.stdout.write(JSON.stringify({decision:"deny",reason:"from the program"}))',
    ],
    targets: ["claude"],
    timeout_ms: 60000,
    version,
  });

  it("is pinned by version, not hash, and runs from PATH", async (t) => {
    const root = project(t, {});
    const entries = readCustom(root, {}, { custom: [program(nodeVersion)] });
    const [pinned] = pinnedEntries(root, entries, ["claude"]);
    expect(pinned).toMatchObject({ version: nodeVersion });
    expect(pinned).not.toHaveProperty("guardSha256");
    expect(
      await decide(
        {
          ...input(root, "before_tool"),
          tool: { kind: "shell", native: "Bash", command: "ls", paths: [] },
        },
        compiled([], { custom: [pinned!] }),
      ),
    ).toMatchObject({ verdict: "deny", reason: "from the program" });
  });

  it("is refused at projection when the program reports another version", (t) => {
    const root = project(t, {});
    const write = (version: string) => {
      writeFileSync(
        join(root, "pmcp.toml"),
        `[targets]\ntools = ["claude"]\n[sessions]\nstate_dir = ".state"\n[[hooks.guards.custom]]\nname = "tool"\ncommand = ${JSON.stringify(program(version).command)}\ntargets = ["claude"]\nversion = "${version}"\n`,
      );
      return projectFiles(readSpec(readConfig(join(root, "pmcp.toml"))), {
        check: false,
      });
    };
    const refused = write("0.0.1");
    expect(refused.code).toBe(3);
    expect(refused.problems[0]).toContain(
      "custom guard tool: node --version reports",
    );
    expect(write(nodeVersion).code).toBe(0);
  });

  it("needs version to name a program, and never pins a script by version", (t) => {
    const root = project(t, {});
    expect(() =>
      readCustom(
        root,
        {},
        {
          custom: [{ ...program(nodeVersion), version: undefined }],
        },
      ),
    ).toThrow("or name an installed program with version");
    expect(() =>
      readCustom(
        root,
        {},
        {
          custom: [
            {
              ...program("1.0.0"),
              command: ["sh", ".agents/guards/guard.sh"],
            },
          ],
        },
      ),
    ).toThrow("a script under .agents/guards/ is pinned by its hash");
  });

  it("matches the version as a whole token", () => {
    expect(versionMatches("tool 1.2.3 (abc)", "1.2.3")).toBe(true);
    expect(versionMatches("v1.2.3", "1.2.3")).toBe(true);
    expect(versionMatches("tool 1.2.30", "1.2.3")).toBe(false);
    expect(versionMatches("tool 11.2.3", "1.2.3")).toBe(false);
  });
});

describe("the shell adapter", () => {
  it("refuses the new events and installed programs for a runtime it serves", (t) => {
    const root = project(t, {});
    const [stop] = readCustom(
      root,
      {},
      {
        custom: [
          {
            name: "guard",
            command: ["sh", ".agents/guards/guard.sh"],
            targets: ["codex"],
            on: "stop",
          },
        ],
      },
    );
    expect(() => legacyEntries([stop!], false)).toThrow(
      'custom guard guard: on = "stop" needs the hook bundle for codex',
    );
  });
});

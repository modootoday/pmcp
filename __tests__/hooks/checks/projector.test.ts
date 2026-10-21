import { chmodSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { harness, put } from "./_shared.js";

const onStop = { project_check: true, report: "context" };
const LOCAL = "node_modules/@modootoday/pmcp/dist/cli.js";

function cli(
  path: string,
  version = "0.17.4",
  code = 2,
  output = "x drift: pmcp.lock",
): void {
  put(
    path,
    `require("node:fs").appendFileSync(${JSON.stringify(`${path}.calls`)}, process.argv.slice(2).join(" ") + "\\n");\nif (process.argv[2] === "--version") console.log(${JSON.stringify(version)});\nelse { console.error(${JSON.stringify(output)}); process.exitCode = ${code}; }\n`,
  );
}

const calls = (path: string) =>
  existsSync(`${path}.calls`) ? readFileSync(`${path}.calls`, "utf8") : "";

function checkout(runtime: "claude" | "codex") {
  const h = harness(runtime, { checks: { on_stop: onStop } });
  put(
    join(h.root, "pmcp.lock"),
    JSON.stringify({ version: 1, pmcp_version: "0.17.4", outputs: [] }),
  );
  const record = (path: string) =>
    put(
      join(h.root, "state/projector.json"),
      JSON.stringify({
        [realpathSync(h.root)]: { cli: path, version: "0.17.4" },
      }),
    );

  async function stop(): Promise<readonly string[]> {
    await h.edit(join(h.root, "sample.ts"));
    const stopped = await h.run("Stop", {
      prompt_id: `t${Math.random()}`,
      turn_id: `t${Math.random()}`,
    });
    if (runtime === "claude") return stopped.decision.context ?? [];
    return (await h.run("UserPromptSubmit")).decision.context ?? [];
  }
  return { h, record, stop };
}

describe.each(["claude", "codex"] as const)(
  "on_stop finds the projecting pmcp on %s",
  (runtime) => {
    it("never asks an old global pmcp on PATH and reports the missing CLI once per session", async () => {
      const { h, stop } = checkout(runtime);
      const global = join(h.root, "bin/pmcp");
      put(
        global,
        `#!/bin/sh\necho "$@" >> ${JSON.stringify(`${global}.calls`)}\nexit 2\n`,
      );
      chmodSync(global, 0o755);
      vi.stubEnv("PATH", `${join(h.root, "bin")}:${process.env["PATH"]}`);
      try {
        expect(await stop()).toEqual([
          "on_stop: projecting pmcp not available (no local or recorded pmcp)",
        ]);
        expect(await stop()).toEqual([]);
      } finally {
        vi.unstubAllEnvs();
      }
      expect(calls(global)).toBe("");
    });

    it("reports a recorded CLI that no longer exists", async () => {
      const { h, record, stop } = checkout(runtime);
      const gone = join(h.root, "gone/dist/cli.js");
      record(gone);
      expect(await stop()).toEqual([
        `on_stop: projecting pmcp not available (${gone})`,
      ]);
    });

    it("reports a CLI whose version differs from pmcp.lock without running the check", async () => {
      const { h, stop } = checkout(runtime);
      const local = join(h.root, LOCAL);
      cli(local, "0.16.1");
      expect(await stop()).toEqual([
        `on_stop: projecting pmcp not available (${local})`,
      ]);
      expect(calls(local)).toBe("--version\n");
    });

    it("prefers the checkout's own pmcp over the recorded one and reports its drift", async () => {
      const { h, record, stop } = checkout(runtime);
      const local = join(h.root, LOCAL);
      const recorded = join(h.root, "elsewhere/dist/cli.js");
      cli(local);
      cli(recorded, "0.17.4", 0);
      record(recorded);
      expect((await stop())[0]).toContain("projection check failed");
      expect(calls(local)).toBe("--version\nproject --check\n");
      expect(calls(recorded)).toBe("");
    });

    it("runs the recorded CLI when the checkout has none, quiet when it matches", async () => {
      const { h, record, stop } = checkout(runtime);
      const recorded = join(h.root, "elsewhere/dist/cli.js");
      cli(recorded, "0.17.4", 0);
      record(recorded);
      expect(await stop()).toEqual([]);
      expect(calls(recorded)).toBe("--version\nproject --check\n");
    });

    it("reports a permission conflict like drift", async () => {
      const { h, stop } = checkout(runtime);
      cli(
        join(h.root, LOCAL),
        "0.17.4",
        2,
        "x conflict: .claude/settings.json#permissions.ask owned entry edited or removed Read(.env)",
      );
      expect((await stop())[0]).toContain("projection check failed");
    });

    it("keeps a check that fails without naming drift quiet", async () => {
      const { h, stop } = checkout(runtime);
      cli(
        join(h.root, LOCAL),
        "0.17.4",
        2,
        "x pmcp.toml: [mcp.skills] unknown field auth",
      );
      expect(await stop()).toEqual([]);
    });
  },
);

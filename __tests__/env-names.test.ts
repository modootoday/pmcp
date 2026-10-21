import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, type TestContext } from "vitest";

import { spawnRequest } from "../src/harness/adapters/terminal/lifecycle.js";
import { groupEnv, projectHarnessEnv } from "../src/harness/groups/service.js";
import { readConfig } from "../src/config.js";
import { readSpec } from "../src/project/spec.js";
import { hostUp, type HostRun } from "../src/harness/host/up.js";
import { envNames, pickEnv } from "../src/native/env-names.js";
import { hostEnvDoctor, hostManifest, readHost } from "../src/project/host.js";
import type { ProjectSpec } from "../src/project/spec.js";

// Live, a gemini worker on Vertex sat at "Waiting for authentication" when the project and
// location never reached it; declared names make the need explicit and a missing one refuses.
describe("env passed by declared name", () => {
  it("accepts environment variable names only, never pmcp-pty's own", () => {
    expect(
      envNames(["GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT", "A_1"], "env"),
    ).toEqual(["GOOGLE_CLOUD_PROJECT", "A_1"]);
    expect(envNames(undefined, "env")).toEqual([]);
    expect(() => envNames(["google_cloud"], "env")).toThrow(
      "environment variable name",
    );
    expect(() => envNames(["A=B"], "env")).toThrow("environment variable name");
    expect(() => envNames(["PMCP_PTY_SESSION"], "env")).toThrow(
      "set by pmcp-pty itself",
    );
    expect(() => envNames("GOOGLE_CLOUD_PROJECT", "env")).toThrow(
      "must be a list",
    );
  });

  it("picks set values and calls an unset or empty name missing", () => {
    expect(pickEnv(["A", "B", "C"], { A: "1", B: "" })).toEqual({
      values: { A: "1" },
      missing: ["B", "C"],
    });
  });

  it("reads [[host.sessions]] env and projects the names only when declared", () => {
    const host = readHost("pmcp.toml", {
      sessions: [
        {
          name: "gem",
          runtime: "gemini",
          env: ["GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION"],
        },
        { name: "cdx", runtime: "codex" },
      ],
    })!;
    const manifest = hostManifest(host) as {
      sessions: Record<string, unknown>[];
    };
    expect(manifest.sessions[0]!["env"]).toEqual([
      "GOOGLE_CLOUD_PROJECT",
      "GOOGLE_CLOUD_LOCATION",
    ]);
    expect("env" in manifest.sessions[1]!).toBe(false);
    expect(() =>
      readHost("pmcp.toml", {
        sessions: [{ name: "gem", runtime: "gemini", env: ["bad-name"] }],
      }),
    ).toThrow("environment variable name");
  });

  it("doctor lists each session's declared names as set or not, without values", () => {
    const host = readHost("pmcp.toml", {
      sessions: [{ name: "gem", runtime: "gemini", env: ["P", "L"] }],
    })!;
    const spec = { host } as unknown as ProjectSpec;
    expect(hostEnvDoctor(spec, { P: "secret", L: "global" })[0]).toMatchObject({
      status: "ok",
      detail: "set: P, L",
    });
    const unset = hostEnvDoctor(spec, { P: "secret" })[0]!;
    expect(unset).toMatchObject({ status: "warn" });
    expect(unset.detail).toContain("not set: L");
    expect(JSON.stringify(unset)).not.toContain("secret");
  });

  function approved(t: TestContext): string {
    const dir = mkdtempSync(join(tmpdir(), "pmcp-env-up-"));
    t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(
      join(dir, "host.json"),
      JSON.stringify({
        version: 1,
        sessions: [
          {
            name: "gem",
            profile: "gemini",
            cwd: ".",
            argv: ["gemini"],
            labels: { "pmcp.host": "gem" },
            restart: "no",
            max_restarts: 0,
            delivery_setup: true,
            env: ["GOOGLE_CLOUD_PROJECT"],
          },
        ],
      }),
    );
    writeFileSync(
      join(dir, "policy.json"),
      JSON.stringify({ version: 1, roots: ["."], allow: [] }),
    );
    return dir;
  }

  function run(t: TestContext, env: Record<string, string>) {
    const seen: Record<string, unknown>[] = [];
    const dir = approved(t);
    const host: HostRun = {
      root: "/proj",
      approvedDir: dir,
      journal: join(dir, "runs.jsonl"),
      env,
      call: async (request) => {
        seen.push(request);
        if (request["op"] === "list") return { ok: true, sessions: [] };
        return { ok: true, id: "s1", pid: 1, instance: "i" };
      },
    };
    return { host, seen };
  }

  it("host up passes a declared value in the spawn request and refuses a session without it", async (t) => {
    const ok = run(t, { GOOGLE_CLOUD_PROJECT: "demo", OTHER: "x" });
    expect((await hostUp(ok.host))[0]).toMatchObject({
      name: "gem",
      action: "started",
    });
    const spawn = ok.seen.find((request) => request["op"] === "spawn")!;
    expect(spawn["env"]).toEqual({ GOOGLE_CLOUD_PROJECT: "demo" });

    const missing = run(t, {});
    const step = (await hostUp(missing.host))[0]!;
    expect(step).toMatchObject({ name: "gem", action: "refused" });
    expect(step.detail).toContain("GOOGLE_CLOUD_PROJECT not set");
    expect(missing.seen.some((request) => request["op"] === "spawn")).toBe(
      false,
    );
  });

  it("a harness group keeps names only, and the spawn request carries the values", () => {
    expect(groupEnv(["GOOGLE_CLOUD_PROJECT"])).toEqual([
      "GOOGLE_CLOUD_PROJECT",
    ]);
    expect(() => groupEnv(["not a name"])).toThrow("invalid_env_names");
    const connection = {
      binary: () => "/bin/pmcp-pty",
      records: { owner: "o" },
    };
    const request = spawnRequest(
      connection as never,
      "id",
      "nonce",
      ["gemini"],
      "/proj",
      "gemini-cli",
      { GOOGLE_CLOUD_PROJECT: "demo" },
    );
    expect(request.env).toEqual({
      GOOGLE_CLOUD_PROJECT: "demo",
      PMCP_PTY_BIN: "/bin/pmcp-pty",
    });
  });

  it("[harness] env in pmcp.toml is validated and is a group's default", (t) => {
    const dir = mkdtempSync(join(tmpdir(), "pmcp-harness-env-"));
    t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const toml = (body: string) =>
      writeFileSync(
        join(dir, "pmcp.toml"),
        `[targets]\ntools = ["claude"]\n${body}`,
      );
    toml(
      `[harness]\nenv = ["GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION"]\n`,
    );
    expect(readSpec(readConfig(join(dir, "pmcp.toml"))).harness).toEqual({
      env: ["GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION"],
    });
    expect(groupEnv(projectHarnessEnv(dir))).toEqual([
      "GOOGLE_CLOUD_PROJECT",
      "GOOGLE_CLOUD_LOCATION",
    ]);
    toml(`[harness]\nenv = ["lower"]\n`);
    expect(() => readSpec(readConfig(join(dir, "pmcp.toml")))).toThrow(
      "environment variable name",
    );
    expect(() => groupEnv(projectHarnessEnv(dir))).toThrow("invalid_env_names");
    toml(`[harness]\nvars = ["X"]\n`);
    expect(() => readSpec(readConfig(join(dir, "pmcp.toml")))).toThrow(
      "[harness] unknown key vars",
    );
    toml("");
    expect(projectHarnessEnv(dir)).toBeUndefined();
  });
});

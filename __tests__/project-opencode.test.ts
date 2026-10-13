import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, type TestContext } from "vitest";

import { readConfig } from "../src/config.js";
import { project } from "../src/project/apply.js";
import { doctor, type RunResult } from "../src/project/doctor.js";
import { memoryFindings } from "../src/project/memory.js";
import { planMcpImport } from "../src/project/mcp-import.js";
import { readSpec } from "../src/project/spec.js";
import { runtimeOfClient, verifiedRuntimesOf } from "../src/runtime.js";

interface NativeConfig {
  provider?: unknown;
  model?: string;
  permission?: { bash?: string; skill?: Record<string, string> };
  mcp?: Record<
    string,
    {
      type: string;
      command?: string[];
      environment?: Record<string, string>;
      headers?: Record<string, string>;
      timeout?: number;
    }
  >;
}

function fixture(t: TestContext, extra = "") {
  const root = mkdtempSync(join(tmpdir(), "pmcp-opencode-"));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const config = join(root, "pmcp.toml");
  writeFileSync(config, '[targets]\ntools = ["opencode"]\n' + extra);
  const spec = () => readSpec(readConfig(config));
  const projectFile = join(root, "opencode.json");
  const apply = () => {
    const result = project(spec(), { check: false });
    if (result.backup)
      t.onTestFinished(() =>
        rmSync(result.backup!, { recursive: true, force: true }),
      );
    return result;
  };
  const read = () =>
    JSON.parse(readFileSync(projectFile, "utf8")) as NativeConfig;
  const skill = (name: string) => {
    const directory = join(root, ".agents/skills", name);
    mkdirSync(directory, { recursive: true });
    const path = join(directory, "SKILL.md");
    writeFileSync(
      path,
      `---\nname: ${name}\ndescription: Fixture workflow\n---\n\nFixture body.\n`,
    );
    return path;
  };
  return { root, config, projectFile, spec, apply, read, skill };
}

describe("OpenCode project projection", () => {
  it("preserves provider preferences and unmanaged servers across idempotent projection and removal", (t) => {
    const f = fixture(
      t,
      '[mcp.skills]\ncommand = "node"\nargs = ["fixture.js"]\n',
    );
    const unmanaged = {
      provider: { fixture: { options: { apiKey: "{env:FIXTURE_TOKEN}" } } },
      model: "fixture/model",
      mcp: { other: { type: "local", command: ["node", "other.js"] } },
    };
    writeFileSync(f.projectFile, JSON.stringify(unmanaged));
    const initial = f.apply();
    expect(initial.code).toBe(0);
    expect(initial.backup).toBeDefined();
    expect(f.read()).toMatchObject(unmanaged);
    expect(f.read().mcp?.skills).toEqual({
      type: "local",
      command: ["node", "fixture.js"],
      enabled: true,
    });
    const text = readFileSync(f.projectFile, "utf8");
    expect(f.apply().backup).toBeUndefined();
    expect(readFileSync(f.projectFile, "utf8")).toBe(text);
    expect(project(f.spec(), { check: true }).code).toBe(0);
    writeFileSync(f.config, "[targets]\ntools = []\n");
    expect(f.apply().code).toBe(0);
    expect(f.read()).toEqual(unmanaged);
  });

  it("refuses an unowned alias collision without altering its configuration or creating a lock", (t) => {
    const f = fixture(
      t,
      '[mcp.skills]\ncommand = "node"\nargs = ["fixture.js"]\n',
    );
    const original = JSON.stringify({
      mcp: { skills: { type: "local", command: ["other"] } },
    });
    writeFileSync(f.projectFile, original);
    expect(f.apply().code).toBe(3);
    expect(readFileSync(f.projectFile, "utf8")).toBe(original);
    expect(existsSync(join(f.root, "pmcp.lock"))).toBe(false);
  });

  it("hides user-only skills through named native permissions without modifying their canonical source", (t) => {
    const f = fixture(t, '[skills.manual]\ninvocation = "user"\n');
    const path = f.skill("manual");
    f.skill("automatic");
    const original = readFileSync(path, "utf8");
    writeFileSync(
      f.projectFile,
      JSON.stringify({
        permission: { bash: "ask", skill: { "*": "ask" } },
        model: "fixture/model",
      }),
    );
    expect(f.apply().code).toBe(0);
    expect(f.read().permission).toEqual({
      bash: "ask",
      skill: { "*": "ask", manual: "deny" },
    });
    expect(readFileSync(path, "utf8")).toBe(original);
    expect(existsSync(join(f.root, ".opencode"))).toBe(false);
    expect(Object.keys(f.read())).not.toContain("command");
    writeFileSync(f.config, '[targets]\ntools = ["opencode"]\n');
    expect(f.apply().code).toBe(0);
    expect(f.read().permission).toEqual({ bash: "ask", skill: { "*": "ask" } });
  });

  it.for(["deny", { skill: "allow" }, { skill: { manual: "allow" } }])(
    "preserves conflicting native permission shape %j",
    (permission, t) => {
      const f = fixture(t, '[skills.manual]\ninvocation = "user"\n');
      f.skill("manual");
      const original = JSON.stringify({ permission });
      writeFileSync(f.projectFile, original);
      expect(f.apply().code).toBe(3);
      expect(readFileSync(f.projectFile, "utf8")).toBe(original);
    },
  );

  it("launches from a nested directory with portable root, cwd and environment expansion", (t) => {
    const f = fixture(
      t,
      `[mcp.skills]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ["-p", "JSON.stringify([process.cwd(), process.env.FIXTURE_VALUE])"]\ncwd = "\u0024{PROJECT_ROOT}/nested"\nenv = { FIXTURE_VALUE = "\u0024{PROJECT_ROOT}/data" }\n`,
    );
    mkdirSync(join(f.root, "nested"));
    expect(f.apply().code).toBe(0);
    const command = f.read().mcp?.skills?.command;
    expect(command).toBeDefined();
    const output = execFileSync(command![0]!, command!.slice(1), {
      cwd: join(f.root, "nested"),
      encoding: "utf8",
    });
    expect(JSON.parse(output)).toEqual([
      join(f.root, "nested"),
      join(f.root, "data"),
    ]);
  });

  it("preserves remote credential references using the native env syntax and timeout", (t) => {
    const f = fixture(
      t,
      '[mcp.docs]\nurl = "https://example.com/mcp"\nheader_env = { "X-Project" = "FIXTURE_PROJECT" }\nbearer_token_env_var = "FIXTURE_BEARER"\n[mcp.docs.native.opencode]\ntimeout = 9000\n',
    );
    expect(f.apply().code).toBe(0);
    expect(f.read().mcp?.docs).toEqual({
      type: "remote",
      url: "https://example.com/mcp",
      enabled: true,
      headers: {
        "X-Project": "{env:FIXTURE_PROJECT}",
        Authorization: "Bearer {env:FIXTURE_BEARER}",
      },
      timeout: 9000,
    });
  });

  it("preserves literal local environment without adding provider or model settings", (t) => {
    const f = fixture(
      t,
      '[mcp.skills]\ncommand = "node"\nargs = ["fixture.js"]\nenv = { MODE = "fixture" }\n',
    );
    expect(f.apply().code).toBe(0);
    expect(f.read().mcp?.skills?.environment).toEqual({ MODE: "fixture" });
    expect(f.read().provider).toBeUndefined();
    expect(f.read().model).toBeUndefined();
  });

  it.for([
    [
      '[mcp.skills]\ncommand = "node"\nmailbox = true\n',
      "mailbox runtime binding",
    ],
    [
      '[mcp.skills]\ncommand = "node"\ntools = ["skill_find"]\n',
      "tool filtering",
    ],
    [
      '[mcp.skills]\ncommand = "node"\n[mcp.skills.native.opencode]\nstartup_timeout_sec = 3\n',
      "unsupported native option",
    ],
  ])("refuses unqualified capability %j", ([extra, reason], t) => {
    const f = fixture(t, extra);
    expect(() => f.apply()).toThrow(reason);
    expect(existsSync(f.projectFile)).toBe(false);
  });

  it("refuses a competing JSONC source before creating projected configuration", (t) => {
    const f = fixture(t, '[mcp.skills]\ncommand = "node"\n');
    const path = join(f.root, "opencode.jsonc");
    writeFileSync(path, "{ /* fixture */ }\n");
    expect(() => f.apply()).toThrow("JSONC projection");
    expect(readFileSync(path, "utf8")).toBe("{ /* fixture */ }\n");
    expect(existsSync(f.projectFile)).toBe(false);
  });

  it("does not silently treat OpenCode import as an empty supported source", (t) => {
    const f = fixture(t);
    writeFileSync(f.projectFile, "{}");
    expect(() =>
      planMcpImport(f.config, [`opencode:${f.projectFile}`]),
    ).toThrow("import is not qualified");
    expect(runtimeOfClient("opencode")).toBeNull();
    expect(verifiedRuntimesOf({ "verified-runtimes": "opencode" })).toEqual([]);
  });
});

describe("OpenCode native doctor", () => {
  it("does not reinterpret an unqualified OpenCode memory target as another runtime", (t) => {
    const f = fixture(t);
    const findings = memoryFindings(f.spec(), {
      home: f.root,
      run: () => {
        throw new Error("Native memory inspection is outside this scope");
      },
    });
    expect(findings[0]?.memory).toEqual({
      state: "unsupported",
      source: "OpenCode native memory metadata is not qualified",
    });
  });
  it.for([
    ["skills connected\n", "ok"],
    [`skills ${String.fromCharCode(27)}[90mconnected\n`, "ok"],
    ["skills disabled\nnode --print connected\n", "fail"],
    ["other connected\n", "fail"],
    ["skills needs authentication\n", "fail"],
  ])("checks the exact native server status: %s", ([stdout, status], t) => {
    const f = fixture(t, '[mcp.skills]\ncommand = "node"\n');
    f.skill("manual");
    f.apply();
    const result = doctor(f.spec(), {
      home: f.root,
      only: new Set(["opencode"]),
      run: (_command, args): RunResult => ({
        missing: false,
        status: 0,
        stdout:
          args[0] === "mcp"
            ? stdout!
            : JSON.stringify([
                {
                  name: "manual",
                  location: join(f.root, ".agents/skills/manual/SKILL.md"),
                },
              ]),
      }),
    });
    expect(
      result.find((entry) => entry.check === "mcp servers connected")?.status,
    ).toBe(status);
    expect(
      result.find((entry) => entry.check === "project skills discovered")
        ?.status,
    ).toBe("ok");
  });

  it("marks a missing native CLI as skipped and malformed native inventory as failed", (t) => {
    const f = fixture(t);
    f.skill("manual");
    f.apply();
    const inspect = (missing: boolean, stdout: string) =>
      doctor(f.spec(), {
        home: f.root,
        run: () => ({ missing, status: 0, stdout }),
      });
    expect(inspect(true, "").at(-1)?.status).toBe("skip");
    expect(inspect(false, "invalid").at(-1)?.status).toBe("fail");
  });
});

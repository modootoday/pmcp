import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, type TestContext } from "vitest";

import { readConfig } from "../../src/config.js";
import {
  approvalDir,
  approvalState,
  hostApprovalDoctor,
  hostDigest,
} from "../../src/project/host-approval.js";
import {
  approveHost,
  type ApproveInput,
} from "../../src/harness/host/approve.js";
import { agentContext } from "../../src/harness/host/operator.js";
import { project } from "../../src/project/apply.js";
import { readSpec } from "../../src/project/spec.js";

const TOML = (option: string) => `
[[host.sessions]]
name = "lead"
runtime = "claude"

[[host.answers]]
runtime = "gemini"
dialog = "tool-approval"
options = ["${option}"]
`;

function setup(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "pmcp-approve-"));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const env = { XDG_STATE_HOME: join(root, "state") };
  const projectWith = (option: string) => {
    writeFileSync(join(root, "pmcp.toml"), TOML(option));
    const spec = readSpec(readConfig(join(root, "pmcp.toml")));
    project(spec, { check: false });
    return spec;
  };
  const spec = projectWith("Allow once");
  const said: string[] = [];
  const input = (
    typed: string,
    more: Partial<ApproveInput> = {},
  ): ApproveInput => ({
    root,
    host: spec.host!,
    env,
    tty: true,
    projectedOk: true,
    ask: async () => typed,
    say: (text) => said.push(text),
    chain: [{ name: "bash", cmdline: "/bin/bash" }],
    ...more,
  });
  return { root, env, said, input, projectWith };
}

const digestOf = (said: readonly string[]) =>
  said.find((l) => l.startsWith("sha256 "))!.slice(7);

describe("pmcp harness host approve", () => {
  // Pinned in pmcp-pty's policy.rs too, which re-checks the approved copy with it.
  it("hashes both files the way pmcp-pty checks them", () => {
    const files = { manifest: '{"a":1}\n', policy: '{"b":2}\n' };
    expect(hostDigest(files)).toBe(
      "bfa51dc1f537f174494fee2cb4bf5fcb53290f1aa2a39ca5f7ac1ce84eb85ce3",
    );
  });

  it("approves only when the operator types the start of the hash, into a private copy", async (t) => {
    const { root, env, said, input } = setup(t);
    const wrong = await approveHost(input("00000000"));
    expect(wrong).toMatchObject({ ok: false });
    expect(approvalState(root, env).state).toBe("unapproved");
    const digest = digestOf(said);
    expect(said).toContain("answers gemini tool-approval: Allow once");
    const ok = await approveHost(input(digest.slice(0, 8)));
    expect(ok).toMatchObject({ ok: true });
    expect(approvalState(root, env).state).toBe("approved");
    const dir = approvalDir(root, env);
    expect(dir).toContain(join("pmcp", "host-approvals"));
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, "policy.json")).mode & 0o777).toBe(0o600);
    expect(hostApprovalDoctor(root, env).status).toBe("ok");
  });

  it("keeps the approved policy when a new projection differs, and spots a tampered copy", async (t) => {
    const { root, env, said, input, projectWith } = setup(t);
    await approveHost(input("x"));
    await approveHost(input(digestOf(said).slice(0, 8)));
    projectWith("Allow always");
    const state = approvalState(root, env);
    expect(state.state).toBe("differs");
    expect(hostApprovalDoctor(root, env)).toMatchObject({ status: "warn" });
    const copy = join(approvalDir(root, env), "policy.json");
    expect(readFileSync(copy, "utf8")).toContain("Allow once");
    writeFileSync(copy, readFileSync(copy, "utf8").replace("once", "always"));
    expect(approvalState(root, env).state).toBe("unapproved");
  });

  it("refuses under an agent, under pmcp-pty, without a terminal or with stale projected files", async (t) => {
    const { input } = setup(t);
    const cases: Partial<ApproveInput>[] = [
      { env: { CLAUDECODE: "1" } },
      { env: { PMCP_PTY_SOCKET: "/run/pty.sock" } },
      {
        chain: [
          {
            name: "node",
            cmdline: "node /x/node_modules/@openai/codex/bin/codex.js",
          },
        ],
      },
      { chain: [{ name: "pmcp-pty", cmdline: "pmcp-pty daemon" }] },
      { tty: false },
      { projectedOk: false },
    ];
    for (const more of cases) {
      const asked: string[] = [];
      const result = await approveHost(
        input("whatever", { ...more, ask: async (q) => (asked.push(q), "x") }),
      );
      expect(result.ok, JSON.stringify(more)).toBe(false);
      expect(asked).toEqual([]);
    }
    expect(agentContext({}, [{ name: "bash", cmdline: "bash" }])).toBeNull();
  });
});

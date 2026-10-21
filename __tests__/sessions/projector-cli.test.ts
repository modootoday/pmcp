import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, type TestContext } from "vitest";

import { readConfig } from "../../src/config.js";
import { sessionsDoctor } from "../../src/project/doctor/sessions.js";
import { readSpec } from "../../src/project/spec.js";
import { noticeOf } from "../../src/sessions/mailbox/format.js";
import { pmcpCommand } from "../../src/sessions/projector-cli.js";
import { wakeText } from "../../src/sessions/wake/index.js";

// A checkout whose own pmcp is installed, and a PATH directory to put a pmcp on.
function scratch(t: TestContext) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pmcp-cli-")));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const cli = join(root, "node_modules/@modootoday/pmcp/dist/cli.js");
  mkdirSync(join(cli, ".."), { recursive: true });
  writeFileSync(cli, "");
  const bin = join(root, "bin");
  mkdirSync(bin);
  const state = join(root, ".state");
  mkdirSync(state);
  return { root, cli, bin, state };
}

describe("the pmcp command a session is told to run", () => {
  it("is plain pmcp when PATH runs the projecting CLI", (t) => {
    const { root, cli, bin, state } = scratch(t);
    symlinkSync(cli, join(bin, "pmcp"));
    expect(pmcpCommand(root, state, bin)).toBe("pmcp");
  });

  it("names the projecting CLI when PATH runs another pmcp, or none", (t) => {
    const { root, cli, bin, state } = scratch(t);
    const stale = join(root, "old-pmcp.js");
    writeFileSync(stale, "");
    symlinkSync(stale, join(bin, "pmcp"));
    expect(pmcpCommand(root, state, bin)).toBe(`node '${cli}'`);
    expect(pmcpCommand(root, state, "")).toBe(`node '${cli}'`);
  });

  it("uses the CLI that last projected the checkout when none is installed in it", (t) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "pmcp-cli-")));
    t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const cli = join(root, "elsewhere/dist/cli.js");
    mkdirSync(join(cli, ".."), { recursive: true });
    writeFileSync(cli, "");
    writeFileSync(
      join(root, "projector.json"),
      JSON.stringify({ [root]: { cli, version: "0.17.4" } }),
    );
    expect(pmcpCommand(root, root, "")).toBe(`node '${cli}'`);
    // Without any projecting CLI there is nothing better than pmcp.
    expect(pmcpCommand(join(root, "elsewhere"), join(root, "none"), "")).toBe(
      "pmcp",
    );
  });

  it("is what the mailbox notice and the wake text name", () => {
    const message = {
      id: "1000000000000-0a0b0c0d",
      from: { alias: "lead" },
      to: ["all"],
      body: "hi",
      createdAt: "",
      expiresAt: "",
      once: false,
    };
    const command = "node '/w/node_modules/@modootoday/pmcp/dist/cli.js'";
    const notice = noticeOf([message], 0, 5, "s-1", command);
    expect(notice).toContain(
      `Acknowledge: ${command} sessions ack <id> --session s-1`,
    );
    expect(notice).toContain(
      `Reply: ${command} sessions reply <id> --session s-1`,
    );
    expect(wakeText("s-1", [message], command)).toContain(
      `nothing else first: ${command} sessions inbox --session s-1`,
    );
  });

  it("is reported by doctor when PATH does not run the projecting CLI", (t) => {
    const { root, cli, bin } = scratch(t);
    writeFileSync(
      join(root, "pmcp.toml"),
      '[targets]\ntools = ["claude"]\n\n[hooks]\ntargets = ["claude"]\n\n[sessions]\nstate_dir = ".state"\n\n[sessions.registry]\n\n[sessions.mailbox]\n',
    );
    const spec = readSpec(readConfig(join(root, "pmcp.toml")));
    const check = (path: string) =>
      sessionsDoctor(spec, { home: root, env: { PATH: path } }).find(
        (finding) => finding.check === "pmcp on PATH is the projecting CLI",
      );
    expect(check("")).toMatchObject({
      status: "warn",
      detail: `no pmcp on PATH; mailbox notices say node '${cli}'`,
    });
    symlinkSync(cli, join(bin, "pmcp"));
    expect(check(bin)).toMatchObject({ status: "ok" });
  });
});

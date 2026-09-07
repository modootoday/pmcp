import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { whoamiCommand } from "../src/commands/session.js";
import { Ui } from "../src/cli/ui.js";
import { globalDir } from "../src/remote/session.js";

const homes: string[] = [];
afterEach(() => {
  for (const path of homes.splice(0))
    rmSync(path, { recursive: true, force: true });
  delete process.env["HOME"];
});

function withSession(session?: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), "pmcp-whoami-"));
  homes.push(root);
  process.env["HOME"] = root;
  if (session) {
    mkdirSync(globalDir(root), { recursive: true });
    writeFileSync(
      join(globalDir(root), "session.json"),
      JSON.stringify(session),
    );
  }
  return root;
}

interface Stream {
  written: string;
  write(text: string): void;
}
const stream = (): Stream => ({
  written: "",
  write(text: string) {
    this.written += text;
  },
});

function invoke(flags: string[] = []) {
  const out = stream();
  const err = stream();
  const ui = new Ui({
    stdout: out,
    stderr: err,
    color: false,
    env: {},
  });
  const code = whoamiCommand.run({
    ui,
    args: { flags: new Set(flags), options: new Map(), positional: [] },
    env: process.env,
    cwd: process.cwd(),
  } as Parameters<typeof whoamiCommand.run>[0]);
  return { code, out: out.written, err: err.written };
}

it("answers on stdout, because the answer is what the command is for", () => {
  withSession({
    issuer: "https://auth.pmcp.build/",
    accessToken: "secret-token-value",
    scope: "pmcp:catalog:read",
    expiresAt: Date.now() + 600_000,
  });
  const result = invoke();
  // Redirecting the command must capture the answer, not an empty file.
  expect(result.out).toContain("issuer https://auth.pmcp.build/");
  expect(result.out).toContain("scope pmcp:catalog:read");
  expect(result.out).toMatch(/token valid for \d+ min/u);
  expect(result.code).toBe(0);
});

it("never prints the token on any stream", () => {
  withSession({
    issuer: "https://auth.pmcp.build/",
    accessToken: "secret-token-value",
    refreshToken: "secret-refresh-value",
  });
  for (const flags of [[], ["json"]]) {
    const result = invoke(flags);
    expect(result.out + result.err).not.toContain("secret-token-value");
    expect(result.out + result.err).not.toContain("secret-refresh-value");
  }
});

it("says it is signed out on stdout and exits non-zero", () => {
  withSession();
  const result = invoke();
  expect(result.out).toContain("not signed in");
  expect(result.code).toBe(1);

  const asJson = invoke(["json"]);
  expect(JSON.parse(asJson.out)).toEqual({ signedIn: false });
  expect(asJson.code).toBe(1);
});

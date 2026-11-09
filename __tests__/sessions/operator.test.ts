import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  operatorCheck,
  readOperatorSettings,
} from "../../src/sessions/operator.js";

const shell = [{ name: "bash", cmdline: "bash" }];
const agent = [
  { name: "bash", cmdline: "bash" },
  { name: "claude", cmdline: "claude" },
];

describe("the operator check", () => {
  const tty = { via: "tty" } as const;

  it("passes an interactive terminal outside every agent session", () => {
    expect(operatorCheck(tty, { env: {}, tty: true, chain: shell })).toEqual({
      ok: true,
    });
  });

  it("refuses an agent session, by its process or its environment, even on a terminal", () => {
    const byProcess = operatorCheck(tty, { env: {}, tty: true, chain: agent });
    expect(byProcess).toMatchObject({ ok: false });
    expect(JSON.stringify(byProcess)).toContain("runs under claude");
    const byEnv = operatorCheck(tty, {
      env: { CODEX_THREAD_ID: "t" },
      tty: true,
      chain: shell,
    });
    expect(JSON.stringify(byEnv)).toContain("CODEX_THREAD_ID is set");
  });

  it("refuses a command without an interactive terminal", () => {
    expect(
      JSON.stringify(operatorCheck(tty, { env: {}, tty: false, chain: shell })),
    ).toContain("standard input is not one");
  });

  it("with a token, passes only the matching token from a private file", (t) => {
    const dir = mkdtempSync(join(tmpdir(), "pmcp-operator-"));
    t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "token");
    writeFileSync(file, "s3cret\n", { mode: 0o600 });
    const token = { via: "token", tokenFile: file } as const;
    const probe = (value?: string) => ({
      env: value === undefined ? {} : { PMCP_OPERATOR_TOKEN: value },
      tty: false,
      chain: agent,
    });
    expect(operatorCheck(token, probe("s3cret")).ok).toBe(true);
    expect(JSON.stringify(operatorCheck(token, probe("wrong")))).toContain(
      "does not match",
    );
    expect(JSON.stringify(operatorCheck(token, probe()))).toContain(
      "PMCP_OPERATOR_TOKEN is not set",
    );
    chmodSync(file, 0o644);
    expect(JSON.stringify(operatorCheck(token, probe("s3cret")))).toContain(
      "chmod 600",
    );
  });
});

describe("[sessions.operator]", () => {
  it("defaults to the terminal and reads a token file outside the project", () => {
    expect(readOperatorSettings({}, "/p")).toEqual({ via: "tty" });
    expect(
      readOperatorSettings(
        { operator: { via: "token", token_file: "/etc/pmcp/operator" } },
        "/p",
      ),
    ).toEqual({ via: "token", tokenFile: "/etc/pmcp/operator" });
  });

  it("refuses unknown keys, a relative or in-project token file, and a token file for tty", () => {
    const read = (operator: unknown) => () =>
      readOperatorSettings({ operator }, "/p");
    expect(read({ via: "login" })).toThrow('via must be "tty" or "token"');
    expect(read({ who: "me" })).toThrow("unknown key who");
    expect(read({ via: "token" })).toThrow("needs token_file");
    expect(read({ via: "token", token_file: "op" })).toThrow(
      "must be absolute",
    );
    expect(read({ via: "token", token_file: "/p/sub/op" })).toThrow(
      "outside the project",
    );
    expect(read({ token_file: "/etc/op" })).toThrow(
      'token_file goes with via = "token"',
    );
  });
});

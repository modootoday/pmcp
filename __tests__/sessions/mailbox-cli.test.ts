import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, type TestContext } from "vitest";

import { Ui } from "../../src/cli/ui.js";
import { dispatch } from "../../src/commands/index.js";
import { operatorToken } from "../operator-token.js";

const CLI = join(import.meta.dirname, "../../dist/cli.js");

function project(
  t: TestContext,
  mailbox = "[sessions.mailbox]\nttl_minutes = 30\n",
) {
  const root = mkdtempSync(join(tmpdir(), "pmcp-mailbox-cli-"));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const operator = operatorToken();
  writeFileSync(
    join(root, "pmcp.toml"),
    `[sessions]\nstate_dir = ".state"\n${mailbox}${operator.toml}`,
  );
  const runIn = async (env: Record<string, string>, ...argv: string[]) => {
    let output = "";
    const capture = { write: (text: string) => void (output += text) };
    const ui = new Ui({ stdout: capture, stderr: capture });
    const code = await dispatch(argv, {
      cwd: root,
      env: { HOME: root, ...operator.env, ...env },
      ui,
    });
    return { code, output };
  };
  const run = (...argv: string[]) => runIn({}, ...argv);
  return { root, run, runIn, operator, state: join(root, ".state") };
}

describe("a CLI command run inside a runtime", () => {
  it("acts as the session the runtime exposes", async (t) => {
    const { run, runIn, state } = project(t);
    const sent = JSON.parse(
      (await run("sessions", "send", "--json", "--to", "all", "hi")).output,
    ).data;
    const env = { CODEX_THREAD_ID: "01aaaaaa-codex-0001" };
    expect((await runIn(env, "sessions", "ack", sent.id)).code).toBe(0);
    expect(
      existsSync(join(state, "inbox", "01aaaaaa-codex-0001", `${sent.id}.ack`)),
    ).toBe(true);
    const reply = JSON.parse(
      (await runIn(env, "sessions", "reply", "--json", sent.id, "ok")).output,
    ).data;
    expect(reply.from).toEqual({ session: "01aaaaaa-codex-0001" });
  });

  it("refuses to act as the operator when the session is unknown", async (t) => {
    const { run, runIn } = project(t);
    const sent = JSON.parse(
      (await run("sessions", "send", "--json", "--to", "all", "hi")).output,
    ).data;
    const result = await runIn({ GEMINI_CLI: "1" }, "sessions", "ack", sent.id);
    expect(result.code).toBe(2);
    expect(result.output).toMatch(
      /running inside gemini but its session is unknown; pass --session <id>/u,
    );
  });

  it("sends as operator only from the operator, never on a forged --by", async (t) => {
    const { runIn } = project(t);
    const plain = { PMCP_OPERATOR_TOKEN: "" };
    const unsigned = await runIn(
      plain,
      "sessions",
      "send",
      "--to",
      "all",
      "hi",
    );
    expect(unsigned.code).toBe(2);
    expect(unsigned.output).toContain("say who you are with --session");
    const forged = await runIn(
      { CODEX_THREAD_ID: "01aaaaaa-codex-0001", PMCP_OPERATOR_TOKEN: "" },
      ...["sessions", "send", "--by", "operator", "--to", "all", "hi"],
    );
    expect(forged.code).toBe(2);
    expect(forged.output).toContain("--by operator is for the operator");
  });
});

describe("pmcp sessions send, inbox, ack and reply", () => {
  it("refuses when [sessions.mailbox] is not declared", async (t) => {
    const { run } = project(t, "");
    const result = await run("sessions", "send", "--to", "all", "hello");
    expect(result.code).not.toBe(0);
    expect(result.output).toMatch(/declare \[sessions\.mailbox\]/u);
  });

  it("sends, lists, acknowledges per recipient and replies, all with --json", async (t) => {
    const { run } = project(t);
    const sent = JSON.parse(
      (
        await run(
          "sessions",
          "send",
          "--json",
          "--to",
          "alias:kit",
          "--subject",
          "deploy",
          "--once",
          "hold",
          "the",
          "deploy",
        )
      ).output,
    ).data;
    expect(sent).toMatchObject({
      to: ["alias:kit"],
      subject: "deploy",
      body: "hold the deploy",
      once: true,
    });
    const inbox = JSON.parse(
      (await run("sessions", "inbox", "--json", "--by", "kit")).output,
    ).data;
    expect(inbox.map((m: { id: string }) => m.id)).toEqual([sent.id]);
    expect(
      JSON.parse(
        (await run("sessions", "inbox", "--json", "--by", "bo")).output,
      ).data,
    ).toEqual([]);
    expect((await run("sessions", "ack", "--by", "kit", sent.id)).code).toBe(0);
    expect(
      JSON.parse(
        (await run("sessions", "inbox", "--json", "--by", "kit")).output,
      ).data,
    ).toEqual([]);
    const all = JSON.parse(
      (await run("sessions", "inbox", "--json", "--all", "--by", "kit")).output,
    ).data;
    expect(all[0]).toMatchObject({ id: sent.id, acked: true });
    const reply = JSON.parse(
      (await run("sessions", "reply", "--json", "--by", "kit", sent.id, "done"))
        .output,
    ).data;
    expect(reply).toMatchObject({
      to: ["alias:operator"],
      replyTo: sent.id,
      from: { alias: "kit" },
    });
    expect(
      (await run("sessions", "ack", "--by", "kit", "0000000000000-deadbeef"))
        .code,
    ).toBe(1);
  });

  it("checks selectors and resolves a worktree path when sending", async (t) => {
    const { root, run } = project(t);
    expect(
      (await run("sessions", "send", "--to", "team:x", "hi")).code,
    ).not.toBe(0);
    // worktree:<path> is the documented selector; desk:<path> is the older spelling.
    for (const kind of ["desk", "worktree"]) {
      const to = `${kind}:.claude/worktrees/a`;
      const sent = await run("sessions", "send", "--json", "--to", to, "hi");
      expect(JSON.parse(sent.output).data.to).toEqual([
        `${kind}:${join(root, ".claude/worktrees/a")}`,
      ]);
    }
  });

  it("sweeps expired messages with their markers", async (t) => {
    const { run, state } = project(t);
    const sent = JSON.parse(
      (
        await run(
          "sessions",
          "send",
          "--json",
          "--to",
          "all",
          "--ttl",
          "1",
          "x",
        )
      ).output,
    ).data;
    await run("sessions", "ack", "--by", "kit", sent.id);
    const file = join(state, "messages", `${sent.id}.json`);
    const message = JSON.parse(readFileSync(file, "utf8"));
    // Expire it by moving the clock of the message, not the test.
    writeFileSync(
      file,
      JSON.stringify({ ...message, expiresAt: new Date(0).toISOString() }),
    );
    expect((await run("sessions", "sweep")).output).toMatch(
      /1 expired message/u,
    );
    expect(existsSync(file)).toBe(false);
    expect(existsSync(join(state, "inbox", "@kit", `${sent.id}.ack`))).toBe(
      false,
    );
  });

  it("reads the body from stdin when it is -", async (t) => {
    const { root, state, operator } = project(t);
    const code = await new Promise<number>((resolve) => {
      const child = spawn(
        process.execPath,
        [CLI, "sessions", "send", "--by", "kit", "--to", "all", "-"],
        {
          cwd: root,
          env: { ...process.env, ...operator.env },
          stdio: ["pipe", "ignore", "ignore"],
        },
      );
      child.on("close", (status) => resolve(status ?? 1));
      child.stdin.end("line one\nline two\n");
    });
    expect(code).toBe(0);
    const [name] = readdirSync(join(state, "messages"));
    const message = JSON.parse(
      readFileSync(join(state, "messages", name!), "utf8"),
    );
    expect(message.body).toBe("line one\nline two");
  });

  it("loses no message when two processes send at once", async (t) => {
    expect(existsSync(CLI)).toBe(true);
    const { root, state } = project(t);
    const sender = (name: string) =>
      new Promise<number>((resolve) => {
        const loop = `for i in 1 2 3 4 5 6 7 8 9 10 11 12; do node ${JSON.stringify(CLI)} sessions send --by ${name} --to all "${name} $i" || exit 1; done`;
        spawn("sh", ["-c", loop], { cwd: root, stdio: "ignore" }).on(
          "close",
          (code) => resolve(code ?? 1),
        );
      });
    expect(await Promise.all([sender("a"), sender("b")])).toEqual([0, 0]);
    const files = readdirSync(join(state, "messages"));
    expect(files.filter((name) => name.endsWith(".json"))).toHaveLength(24);
    expect(files.filter((name) => name.endsWith(".tmp"))).toEqual([]);
    const bodies = files.map(
      (name) =>
        JSON.parse(readFileSync(join(state, "messages", name), "utf8")).body,
    );
    expect(new Set(bodies).size).toBe(24);
    const audit = readFileSync(join(state, "messages.jsonl"), "utf8")
      .trim()
      .split("\n");
    expect(audit.map((line) => JSON.parse(line).event)).toEqual(
      Array(24).fill("sent"),
    );
  }, 60_000);
});

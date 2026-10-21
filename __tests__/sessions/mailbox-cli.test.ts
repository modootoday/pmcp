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

const CLI = join(import.meta.dirname, "../../dist/cli.js");

function project(
  t: TestContext,
  mailbox = "[sessions.mailbox]\nttl_minutes = 30\n",
) {
  const root = mkdtempSync(join(tmpdir(), "pmcp-mailbox-cli-"));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, "pmcp.toml"),
    `[sessions]\nstate_dir = ".state"\n${mailbox}`,
  );
  const runIn = async (env: Record<string, string>, ...argv: string[]) => {
    let output = "";
    const capture = { write: (text: string) => void (output += text) };
    const ui = new Ui({ stdout: capture, stderr: capture });
    const code = await dispatch(argv, {
      cwd: root,
      env: { HOME: root, ...env },
      ui,
    });
    return { code, output };
  };
  const run = (...argv: string[]) => runIn({}, ...argv);
  return { root, run, runIn, state: join(root, ".state") };
}

describe("a CLI command run inside a runtime", () => {
  it("acts as the session the runtime exposes", async (t) => {
    const { run, runIn, state } = project(t);
    const sent = JSON.parse(
      (await run("sessions", "send", "--json", "--to", "all", "hi")).output,
    );
    const env = { CODEX_THREAD_ID: "01aaaaaa-codex-0001" };
    expect((await runIn(env, "sessions", "ack", sent.id)).code).toBe(0);
    expect(
      existsSync(join(state, "inbox", "01aaaaaa-codex-0001", `${sent.id}.ack`)),
    ).toBe(true);
    const reply = JSON.parse(
      (await runIn(env, "sessions", "reply", "--json", sent.id, "ok")).output,
    );
    expect(reply.from).toEqual({ session: "01aaaaaa-codex-0001" });
  });

  it("warns instead of acting as the operator silently when the session is unknown", async (t) => {
    const { run, runIn } = project(t);
    const sent = JSON.parse(
      (await run("sessions", "send", "--json", "--to", "all", "hi")).output,
    );
    const result = await runIn({ GEMINI_CLI: "1" }, "sessions", "ack", sent.id);
    expect(result.output).toMatch(
      /running inside gemini but its session is unknown; acting as operator/u,
    );
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
    );
    expect(sent).toMatchObject({
      to: ["alias:kit"],
      subject: "deploy",
      body: "hold the deploy",
      once: true,
    });
    const inbox = JSON.parse(
      (await run("sessions", "inbox", "--json", "--by", "kit")).output,
    );
    expect(inbox.map((m: { id: string }) => m.id)).toEqual([sent.id]);
    expect(
      JSON.parse(
        (await run("sessions", "inbox", "--json", "--by", "bo")).output,
      ),
    ).toEqual([]);
    expect((await run("sessions", "ack", "--by", "kit", sent.id)).code).toBe(0);
    expect(
      JSON.parse(
        (await run("sessions", "inbox", "--json", "--by", "kit")).output,
      ),
    ).toEqual([]);
    const all = JSON.parse(
      (await run("sessions", "inbox", "--json", "--all", "--by", "kit")).output,
    );
    expect(all[0]).toMatchObject({ id: sent.id, acked: true });
    const reply = JSON.parse(
      (await run("sessions", "reply", "--json", "--by", "kit", sent.id, "done"))
        .output,
    );
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
      expect(JSON.parse(sent.output).to).toEqual([
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
    );
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
    const { root, state } = project(t);
    const code = await new Promise<number>((resolve) => {
      const child = spawn(
        process.execPath,
        [CLI, "sessions", "send", "--to", "all", "-"],
        { cwd: root, stdio: ["pipe", "ignore", "ignore"] },
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

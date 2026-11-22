import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { Ui } from "../../src/cli/ui.js";
import { harnessCommand } from "../../src/commands/harness.js";
import { importContinuityHistory } from "../../src/harness/continuity/import-history.js";
import { ContinuityJournal } from "../../src/harness/continuity/journal.js";
import { startContinuitySwitch } from "../../src/harness/continuity/switch.js";
import { archiveContinuityHistory } from "../../src/harness/continuity/history-archive.js";
import { historyLaunch } from "../../src/harness/continuity/open-history.js";
import { EXECUTABLES } from "../../src/runtime/ids.js";

it.runIf(Boolean(process.env.PMCP_AGY_HISTORY_FIXTURE))(
  "imports a standalone synthetic agy conversation",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "pmcp-history-"));
    try {
      const journal = await ContinuityJournal.open(
        join(directory, "history.sqlite"),
      );
      try {
        const imported = await importContinuityHistory(journal, {
          runtime: "antigravity",
          source: process.env.PMCP_AGY_HISTORY_FIXTURE!,
          worktreePath: directory,
        });
        expect(imported.messages).toBe(2);
        await expect(
          archiveContinuityHistory({
            runtime: "antigravity",
            sessionId: imported.sessionId.slice("antigravity:".length),
            source: process.env.PMCP_AGY_HISTORY_FIXTURE!,
            archive: join(directory, "common.jsonl"),
            worktree: directory,
          }),
        ).resolves.toMatchObject({ messages: 2 });
        expect(
          journal.read(imported.sessionId)?.checkpoint.events,
        ).toMatchObject([
          { role: "user", text: "Reply exactly PMCP-PILOT. Use no tools." },
          { role: "assistant", text: "PMCP-PILOT" },
        ]);
      } finally {
        journal.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

const fixtureId = "00112233-4455-6677-8899-aabbccddeeff";

it("opens an older archive from the desk root and keeps the nested directory as context", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pmcp-history-desk-"));
  try {
    execFileSync("git", ["init", "-q", directory]);
    const nested = join(directory, "apps", "example");
    await mkdir(nested, { recursive: true });
    const archive = join(directory, "legacy.jsonl");
    await writeFile(
      archive,
      JSON.stringify({ version: 1, worktree: nested }) + "\n",
      { mode: 0o600 },
    );
    const launch = await historyLaunch("codex", archive);
    expect(launch.cwd).toBe(directory);
    expect(launch.args.at(-1)).toContain("apps/example");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
const fixtureTime = "2026-01-01T00:00:00Z";
const lines = (entries: unknown[]) =>
  entries.map((entry) => JSON.stringify(entry)).join("\n");

it.each([
  {
    runtime: "claude",
    filename: "session.jsonl",
    input: lines([
      {
        type: "user",
        sessionId: fixtureId,
        timestamp: fixtureTime,
        message: { content: "question" },
      },
      {
        type: "assistant",
        sessionId: fixtureId,
        timestamp: fixtureTime,
        message: {
          content: [
            { type: "thinking", thinking: "excluded" },
            { type: "text", text: "answer" },
          ],
        },
      },
    ]),
  },
  {
    runtime: "gemini",
    filename: "session.jsonl",
    input: lines([
      { sessionId: fixtureId },
      {
        type: "user",
        timestamp: fixtureTime,
        content: [{ text: "<session_context>excluded</session_context>" }],
      },
      { type: "user", timestamp: fixtureTime, content: [{ text: "question" }] },
      { $set: { lastUpdated: fixtureTime } },
      {
        type: "gemini",
        timestamp: fixtureTime,
        content: "answer",
        thoughts: ["excluded"],
      },
    ]),
  },
  {
    runtime: "grok",
    filename: `${fixtureId}.md`,
    input: "## User\n\nquestion\n\n## Assistant\n\nanswer\n",
  },
] as const)(
  "imports visible $runtime history in order",
  async ({ runtime, filename, input }) => {
    const directory = await mkdtemp(join(tmpdir(), "pmcp-history-"));
    try {
      const journal = await ContinuityJournal.open(
        join(directory, "history.sqlite"),
      );
      try {
        const source = join(directory, filename);
        await writeFile(source, input);
        const archive = join(directory, "common.jsonl");
        await expect(
          archiveContinuityHistory({
            runtime,
            sessionId: fixtureId,
            source,
            archive,
            worktree: directory,
          }),
        ).resolves.toMatchObject({ messages: 2 });
        const imported = await importContinuityHistory(journal, {
          runtime,
          source,
          worktreePath: directory,
        });
        expect(imported).toEqual({
          sessionId: `${runtime}:${fixtureId}`,
          messages: 2,
        });
        expect(
          journal.read(imported.sessionId)?.checkpoint.events,
        ).toMatchObject([
          { role: "user", text: "question", sequence: 1 },
          { role: "assistant", text: "answer", sequence: 2 },
        ]);
      } finally {
        journal.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it("imports Codex messages once, excluding tool output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pmcp-history-"));
  try {
    const source = join(directory, "rollout.jsonl");
    const id = "00112233-4455-6677-8899-aabbccddeeff";
    const timestamp = "2026-01-01T00:00:00Z";
    const rows = [
      { type: "session_meta", payload: { id } },
      {
        type: "event_msg",
        timestamp,
        payload: { type: "user_message", message: "fixture question" },
      },
      {
        type: "response_item",
        timestamp,
        payload: { type: "function_call_output", output: "excluded" },
      },
      {
        type: "event_msg",
        timestamp,
        payload: { type: "agent_message", message: "fixture answer" },
      },
    ];
    await writeFile(source, rows.map((row) => JSON.stringify(row)).join("\n"));
    const database = join(directory, "history.sqlite");
    const output: string[] = [];
    const status = await harnessCommand.run({
      ui: new Ui({ stdout: { write: (text) => output.push(text) } }),
      args: {
        positional: ["history", "import", "codex", source, database, directory],
        flags: new Set(),
        options: new Map(),
        passthrough: [],
      },
      cwd: directory,
      env: {},
    });
    expect(status).toBe(0);
    const archive = join(directory, "common.jsonl");
    expect(
      await archiveContinuityHistory({
        runtime: "codex",
        sessionId: id,
        source,
        archive,
        worktree: directory,
      }),
    ).toMatchObject({ messages: 2 });
    const [, ...archived] = (await readFile(archive, "utf8"))
      .trimEnd()
      .split("\n");
    expect(archived.map((line) => JSON.parse(line).text)).toEqual([
      "fixture question",
      "fixture answer",
    ]);
    for (const target of [
      "codex",
      "claude",
      "grok",
      "gemini",
      "antigravity",
    ] as const) {
      const launch = await historyLaunch(target, archive);
      expect(launch).toMatchObject({
        executable: EXECUTABLES[target],
        cwd: directory,
      });
      expect(launch.args.at(-1)).toContain(archive);
      expect(launch.args.at(-1)).not.toContain("fixture question");
    }
    const journal = await ContinuityJournal.open(database);
    try {
      const options = {
        runtime: "codex",
        source,
        worktreePath: directory,
      } as const;
      const imported = JSON.parse(output.join(""));
      expect(imported).toEqual({
        ok: true,
        sessionId: `codex:${id}`,
        messages: 2,
      });
      const saved = journal.read(imported.sessionId);
      expect(saved?.checkpoint.nativeSessions).toEqual([]);
      expect(saved?.checkpoint.events).toMatchObject([
        { role: "user", text: "fixture question", sequence: 1 },
        { role: "assistant", text: "fixture answer", sequence: 2 },
      ]);
      await expect(importContinuityHistory(journal, options)).rejects.toThrow();
      expect(journal.read(imported.sessionId)).toEqual(saved);
      const next = await startContinuitySwitch(
        journal,
        saved!.checkpoint,
        {
          runtime: "gemini",
          capabilities: { handoff: true, nativeResume: true },
          async collect() {
            throw new Error("unexpected collection");
          },
          async start(request) {
            expect(request).toEqual({
              kind: "handoff",
              context: saved!.checkpoint.events,
              omittedSequences: [],
            });
            return { nativeSessionId: "fixture-destination" };
          },
        },
        new Set([1, 2]),
        new AbortController().signal,
      );
      expect(next.activeRuntime).toBe("gemini");
      expect(next.events).toEqual(saved!.checkpoint.events);
    } finally {
      journal.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

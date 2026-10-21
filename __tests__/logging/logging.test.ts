import {
  mkdirSync,
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
import { createLogger } from "../../src/logging/logger.js";
import { parseSince, pretty, readLogs } from "../../src/logging/query.js";
import {
  DEFAULT_LOG_SETTINGS,
  readLoggingTable,
  withEnvOverride,
} from "../../src/logging/settings.js";
import { fileSink, logFiles, pruneLogs } from "../../src/logging/sinks/file.js";

function dir(t: TestContext): string {
  const path = mkdtempSync(join(tmpdir(), "pmcp-logging-"));
  t.onTestFinished(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

describe("[logging] settings", () => {
  it("reads every key of the table and rejects unknown ones", () => {
    const settings = readLoggingTable({
      level: "warn",
      format: "jsonl",
      max_file_mb: 5,
      keep_days: 3,
      redact: ["secret_values"],
      components: { "hooks.dispatch": "debug" },
    });
    expect(settings).toMatchObject({
      level: "warn",
      maxFileMb: 5,
      keepDays: 3,
      redact: ["secret_values"],
    });
    expect(settings.components).toEqual({ "hooks.dispatch": "debug" });
    expect(() => readLoggingTable({ level: "loud" })).toThrow(/level/u);
    expect(() => readLoggingTable({ rotate: true })).toThrow(
      /unknown key rotate/u,
    );
  });

  it("lets PMCP_LOG override the level and individual components", () => {
    const settings = withEnvOverride(
      DEFAULT_LOG_SETTINGS,
      "debug,hooks.policy=trace,bogus",
    );
    expect(settings.level).toBe("debug");
    expect(settings.components).toEqual({ "hooks.policy": "trace" });
  });

  it("applies a component level to the component and those below it", () => {
    const lines: string[] = [];
    const settings = {
      ...DEFAULT_LOG_SETTINGS,
      level: "warn" as const,
      components: { hooks: "debug" as const },
    };
    createLogger((line) => lines.push(line), settings, {
      component: "hooks.dispatch",
    }).debug("kept");
    createLogger((line) => lines.push(line), settings, {
      component: "sessions.store",
    }).info("dropped");
    expect(lines.map((line) => JSON.parse(line).msg)).toEqual(["kept"]);
  });

  it("keeps prompt text when the project removes prompt_text from redact", () => {
    const lines: string[] = [];
    const settings = {
      ...DEFAULT_LOG_SETTINGS,
      redact: ["secret_values" as const],
    };
    createLogger((line) => lines.push(line), settings).info("x", {
      prompt: "hello",
      token: "t",
    });
    expect(JSON.parse(lines[0]!).data).toEqual({
      prompt: "hello",
      token: "[redacted]",
    });
  });
});

describe("log files", () => {
  it("rolls a file over its size limit and keeps every line", (t) => {
    const logs = dir(t);
    const sink = fileSink({ dir: logs, maxBytes: 200 });
    for (let index = 0; index < 10; index += 1)
      sink(JSON.stringify({ index, pad: "x".repeat(40) }));
    const files = logFiles(logs);
    expect(files.length).toBeGreaterThan(1);
    const total = files.flatMap((file) =>
      readFileSync(file, "utf8").trim().split("\n"),
    );
    expect(total).toHaveLength(10);
  });

  it("removes files older than keep_days by their UTC day", (t) => {
    const logs = dir(t);
    writeFileSync(join(logs, "pmcp-20260101.jsonl"), "{}\n");
    writeFileSync(join(logs, "pmcp-20260101.1.jsonl"), "{}\n");
    writeFileSync(join(logs, "pmcp-20261018.jsonl"), "{}\n");
    expect(pruneLogs(logs, 14, new Date("2026-10-19T00:00:00Z"))).toBe(2);
    expect(readdirSync(logs)).toEqual(["pmcp-20261018.jsonl"]);
  });

  it("filters by session prefix, trace, component subtree, level and time", (t) => {
    const logs = dir(t);
    const line = (fields: object) =>
      JSON.stringify({
        ts: "2026-10-19T10:00:00.000Z",
        level: "info",
        ...fields,
      });
    writeFileSync(
      join(logs, "pmcp-20261019.jsonl"),
      [
        line({
          component: "hooks.entry",
          session: "abcd-1",
          trace: "t1",
          msg: "a",
        }),
        line({
          component: "hooks.policy",
          session: "efgh-2",
          trace: "t2",
          level: "debug",
          msg: "b",
        }),
        line({
          component: "sessions.store",
          session: "abcd-1",
          trace: "t3",
          level: "error",
          ts: "2026-10-19T12:00:00.000Z",
          msg: "c",
        }),
      ].join("\n"),
    );
    const msgs = (filter: Parameters<typeof readLogs>[1]) =>
      readLogs(logs, filter).map((entry) => entry["msg"]);
    expect(msgs({ session: "abcd" })).toEqual(["a", "c"]);
    expect(msgs({ trace: "t2" })).toEqual(["b"]);
    expect(msgs({ component: "hooks" })).toEqual(["a", "b"]);
    expect(msgs({ level: "info" })).toEqual(["a", "c"]);
    expect(msgs({ since: new Date("2026-10-19T11:00:00Z") })).toEqual(["c"]);
    expect(pretty(readLogs(logs, { trace: "t1" })[0]!)).toMatch(
      /INFO +hooks\.entry abcd-1 a$/u,
    );
    expect(
      parseSince("2h", Date.parse("2026-10-19T12:00:00Z")).toISOString(),
    ).toBe("2026-10-19T10:00:00.000Z");
  });

  it("serves pmcp logs from the project's state dir", async (t) => {
    const root = dir(t);
    writeFileSync(
      join(root, "pmcp.toml"),
      '[sessions]\nstate_dir = ".state"\n',
    );
    mkdirSync(join(root, ".state/logs"), { recursive: true });
    const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const now = new Date().toISOString();
    writeFileSync(
      join(root, ".state/logs", `pmcp-${day}.jsonl`),
      `${JSON.stringify({ ts: now, level: "info", component: "hooks.entry", trace: "keep", msg: "hook" })}\n${JSON.stringify({ ts: now, level: "info", trace: "skip", msg: "other" })}\n`,
    );
    let output = "";
    const ui = new Ui({
      stdout: { write: (text) => void (output += text) },
      stderr: { write: () => {} },
    });
    expect(
      await dispatch(["logs", "--trace", "keep", "--since", "1h"], {
        cwd: root,
        env: { HOME: root },
        ui,
      }),
    ).toBe(0);
    expect(
      output
        .trim()
        .split("\n")
        .map((text) => JSON.parse(text).trace),
    ).toEqual(["keep"]);
  });
});

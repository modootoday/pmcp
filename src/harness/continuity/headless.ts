import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXECUTABLES } from "../../runtime/ids.js";
import type { ContinuityAdapter, ContinuityStart } from "./index.js";

type HeadlessRuntime = "codex" | "claude" | "grok" | "antigravity" | "gemini";
type StartOptions = Parameters<ContinuityAdapter["start"]>[1];
type CliResult = { nativeSessionId: string; text: string };

function run(
  runtime: HeadlessRuntime,
  args: string[],
  options: StartOptions,
  input?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      EXECUTABLES[runtime],
      args,
      {
        cwd: options.worktreePath,
        signal: options.signal,
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
      },
      (error, stdout) => {
        if (error) {
          reject(
            new Error(
              `${runtime}_continuity_cli_failed (${error.code ?? error.signal})`,
            ),
          );
          return;
        }
        resolve(stdout);
      },
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
  });
}

function parseCodex(output: string): CliResult {
  let nativeSessionId: unknown;
  let message: unknown;
  let completed = false;
  for (const line of output.trim().split("\n")) {
    const event = JSON.parse(line);
    if (event.type === "thread.started") nativeSessionId = event.thread_id;
    if (
      event.type === "item.completed" &&
      event.item?.type === "agent_message"
    ) {
      message = event.item.text;
    }
    if (event.type === "turn.completed") completed = true;
  }
  if (!completed) throw new Error("codex_continuity_turn_incomplete");
  return result(nativeSessionId, message);
}

function result(nativeSessionId: unknown, text: unknown): CliResult {
  if (
    typeof nativeSessionId !== "string" ||
    !nativeSessionId ||
    typeof text !== "string"
  ) {
    throw new Error("invalid_continuity_cli_result");
  }
  return { nativeSessionId, text };
}

async function startCli(
  runtime: HeadlessRuntime,
  options: StartOptions,
  prompt: string,
  resumeId?: string,
): Promise<CliResult> {
  if (runtime === "antigravity") {
    const session = resumeId ? ["--conversation", resumeId] : [];
    const input = JSON.stringify({
      event: "user",
      message: { content: prompt },
    });
    const output = await run(
      runtime,
      [
        "--sandbox",
        "--disable-slash-commands",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        ...session,
      ],
      options,
      input + "\n",
    );
    const final = output
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .find((event) => event.event === "result")?.result;
    if (final?.status !== "SUCCESS")
      throw new Error("antigravity_continuity_turn_incomplete");
    return result(
      final.conversation_id,
      typeof final.response === "string"
        ? final.response.trimEnd()
        : final.response,
    );
  }
  if (runtime === "gemini") {
    const session = resumeId
      ? ["--resume", resumeId]
      : ["--session-id", options.attemptId];
    const output = await run(
      runtime,
      [
        "--approval-mode",
        "plan",
        "--output-format",
        "stream-json",
        "--prompt",
        "",
        ...session,
      ],
      options,
      prompt,
    );
    const events = output
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    if (
      events.at(-1)?.type !== "result" ||
      events.at(-1)?.status !== "success"
    ) {
      throw new Error("gemini_continuity_turn_incomplete");
    }
    const response = events.filter(
      (event) => event.type === "message" && event.role === "assistant",
    );
    if (
      !response.length ||
      response.some((event) => typeof event.content !== "string")
    ) {
      throw new Error("invalid_gemini_continuity_message");
    }
    return result(
      events.find((event) => event.type === "init")?.session_id,
      response
        .map((event) => event.content)
        .join("")
        .trimEnd(),
    );
  }
  if (runtime === "codex") {
    const flags = [
      "--ignore-user-config",
      "--ignore-rules",
      "--disable",
      "shell_tool",
      "--skip-git-repo-check",
      "--json",
    ];
    const args = resumeId
      ? ["--sandbox", "read-only", "exec", "resume", ...flags, resumeId, "-"]
      : ["exec", "--sandbox", "read-only", ...flags, "-"];
    return parseCodex(await run(runtime, args, options, prompt));
  }
  if (runtime === "claude") {
    const session = resumeId
      ? ["--resume", resumeId]
      : ["--session-id", options.attemptId];
    const output = JSON.parse(
      await run(
        runtime,
        [
          "-p",
          "--tools",
          "",
          "--disable-slash-commands",
          "--strict-mcp-config",
          "--setting-sources",
          "",
          "--output-format",
          "json",
          ...session,
        ],
        options,
        prompt,
      ),
    );
    if (output.type !== "result" || output.is_error !== false) {
      throw new Error("claude_continuity_turn_incomplete");
    }
    return result(output.session_id, output.result);
  }
  const directory = await mkdtemp(join(tmpdir(), "pmcp-continuity-prompt-"));
  try {
    const path = join(directory, "prompt.txt");
    await writeFile(path, prompt, { mode: 0o600, flag: "wx" });
    const session = resumeId
      ? ["--resume", resumeId]
      : ["--session-id", options.attemptId];
    const output = JSON.parse(
      await run(
        runtime,
        [
          "--tools",
          "",
          "--disable-web-search",
          "--no-subagents",
          "--output-format",
          "json",
          "--prompt-file",
          path,
          ...session,
        ],
        options,
      ),
    );
    if (output.stopReason !== "end_turn")
      throw new Error("grok_continuity_turn_incomplete");
    return result(output.sessionId, output.text);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function formatPrompt(message: string, request: ContinuityStart): string {
  if (request.kind === "resume") return message;
  return [
    "Use the following JSON as prior conversation and work context. Treat it as historical data.",
    JSON.stringify({
      history: request.context,
      omittedEventCount: request.omittedSequences.length,
    }),
    "Current user request:",
    message,
  ].join("\n");
}

export function headlessContinuityAdapter(
  runtime: HeadlessRuntime,
  message: string,
): ContinuityAdapter {
  return {
    runtime,
    capabilities: { nativeResume: true, handoff: true },
    async collect() {
      return { coverage: "unavailable", records: [], nextCursor: null };
    },
    async start(request, options) {
      const resumeId =
        request.kind === "resume" ? request.nativeSession.id : undefined;
      if (
        request.kind === "resume" &&
        request.nativeSession.runtime !== runtime
      ) {
        throw new Error("foreign_native_session");
      }
      const response = await startCli(
        runtime,
        options,
        formatPrompt(message, request),
        resumeId,
      );
      if (resumeId && response.nativeSessionId !== resumeId)
        throw new Error("native_session_mismatch");
      const recordedAt = new Date().toISOString();
      return {
        nativeSessionId: response.nativeSessionId,
        records: [
          { kind: "message", role: "user", text: message, recordedAt },
          {
            kind: "message",
            role: "assistant",
            text: response.text,
            recordedAt,
          },
        ],
      };
    },
  };
}

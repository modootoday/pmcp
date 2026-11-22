import { open } from "node:fs/promises";
import { basename } from "node:path";
import { readAntigravityHistory } from "./antigravity-history.js";
import { streamClaudeHistory } from "./claude-history.js";
import { historyDesk } from "./history-desk.js";
import type { ContinuityEvent } from "./index.js";
import type { ContinuityJournal } from "./journal.js";

export const HISTORY_RUNTIMES = [
  "codex",
  "claude",
  "gemini",
  "grok",
  "antigravity",
] as const;
export type HistoryRuntime = (typeof HISTORY_RUNTIMES)[number];

const codexRoles = new Map([
  ["user_message", "user"],
  ["agent_message", "assistant"],
]);

function jsonLines(input: string) {
  return input
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function parse(
  runtime: HistoryRuntime,
  input: string,
  source: string,
  modifiedAt: string,
) {
  if (runtime === "grok") {
    const parts = input.split(/^## (User|Assistant)\r?$/m);
    if (parts[0]?.trim() || parts.length < 3)
      throw new Error("invalid_grok_export");
    const rows = [];
    for (let index = 1; index < parts.length; index += 2) {
      rows.push({
        role: parts[index]?.toLowerCase(),
        content: parts[index + 1]?.trim(),
        timestamp: modifiedAt,
      });
    }
    return { id: basename(source, ".md"), rows };
  }
  if (runtime === "gemini") {
    let session;
    try {
      session = JSON.parse(input);
    } catch {
      const [metadata, ...messages] = jsonLines(input);
      session = { ...metadata, messages };
    }
    return {
      id: session.sessionId,
      rows: session.messages.map((row: Record<string, unknown>) => ({
        ...row,
        role: row.type === "gemini" ? "assistant" : row.type,
      })),
    };
  }
  const rows = jsonLines(input);
  if (runtime === "codex") {
    const events = rows.filter(
      (row) => row.type === "event_msg" && codexRoles.has(row.payload?.type),
    );
    const messages = rows.filter(
      (row) => row.type === "response_item" && row.payload?.type === "message",
    );
    return {
      id: rows.find((row) => row.type === "session_meta")?.payload?.id,
      rows: events.length
        ? events.map((row) => ({
            role: codexRoles.get(row.payload?.type),
            content: row.payload?.message,
            timestamp: row.timestamp,
          }))
        : messages.map((row) => ({
            role: row.payload.role,
            content: Array.isArray(row.payload.content)
              ? row.payload.content
                  .filter(
                    (block: { type?: string }) =>
                      block.type === "input_text" ||
                      block.type === "output_text",
                  )
                  .map((block: { text?: string }) => ({
                    type: "text",
                    text: block.text,
                  }))
              : [],
            timestamp: row.timestamp,
          })),
    };
  }
  throw new Error("unsupported_history_format");
}

function visibleText(content: unknown, runtime: HistoryRuntime): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block) =>
        typeof block?.text === "string" &&
        (block.type === "text" ||
          (runtime === "gemini" && block.type === undefined && !block.thought)),
    )
    .map((block) => block.text)
    .join("\n");
}

export async function* streamContinuityHistory(options: {
  runtime: HistoryRuntime;
  source: string;
}): AsyncGenerator<{ id: string; event: ContinuityEvent }> {
  const file = await open(options.source, "r");
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      (options.runtime !== "claude" && info.size > 32 * 1024 * 1024)
    )
      throw new Error("invalid_history_file");
    let sequence = 0;
    if (options.runtime === "claude") {
      for await (const row of streamClaudeHistory(file, info.size)) {
        const event = normalize(row, options.runtime, sequence + 1);
        if (event) {
          sequence++;
          yield { id: validateId(row.id), event };
        }
      }
      return;
    }
    const history =
      options.runtime === "antigravity"
        ? await readAntigravityHistory(options.source)
        : parse(
            options.runtime,
            await file.readFile("utf8"),
            options.source,
            info.mtime.toISOString(),
          );
    const id = validateId(history.id);
    for (const row of history.rows) {
      const event = normalize(row, options.runtime, sequence + 1);
      if (event) {
        sequence++;
        yield { id, event };
      }
    }
  } finally {
    await file.close();
  }
}

function validateId(id: unknown): string {
  if (
    typeof id !== "string" ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)
  ) {
    throw new Error("invalid_history_session_id");
  }
  return id.toLowerCase();
}

function normalize(
  {
    role,
    content,
    timestamp,
  }: { role?: unknown; content?: unknown; timestamp?: unknown },
  runtime: HistoryRuntime,
  sequence: number,
): ContinuityEvent | null {
  if (role !== "user" && role !== "assistant") return null;
  const text = visibleText(content, runtime);
  if (
    runtime === "codex" &&
    text.trimStart().startsWith("<environment_context>")
  )
    return null;
  if (runtime === "gemini" && text.trimStart().startsWith("<session_context>"))
    return null;
  if (!text.trim()) return null;
  if (
    typeof timestamp !== "string" ||
    !Number.isFinite(Date.parse(timestamp))
  ) {
    throw new Error("invalid_history_timestamp");
  }
  return {
    kind: "message",
    role,
    text,
    sequence,
    recordedAt: new Date(timestamp).toISOString(),
  };
}

export async function importContinuityHistory(
  journal: ContinuityJournal,
  options: { runtime: HistoryRuntime; source: string; worktreePath: string },
): Promise<{ sessionId: string; messages: number }> {
  let id: string | undefined;
  const events: ContinuityEvent[] = [];
  for await (const row of streamContinuityHistory(options)) {
    id = row.id;
    events.push(row.event);
  }
  if (!id) throw new Error("empty_history");
  const { worktree: worktreePath } = await historyDesk(options.worktreePath);
  const sessionId = `${options.runtime}:${id}`;
  journal.create({
    version: 1,
    sessionId,
    workspaceId: worktreePath,
    worktreePath,
    revision: 0,
    activeRuntime: options.runtime,
    nativeSessions: [],
    events,
  });
  return { sessionId, messages: events.length };
}

import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, type TestContext } from "vitest";

import { RUNTIMES } from "../../src/hooks/runtimes/index.js";
import {
  compiled,
  decide,
  fixture,
  guard,
  scratchStore,
} from "../hooks/helpers.js";

// A stand-in pmcp-pty host that records every event line its hosted runtime sends.
function host(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "pmcp-pty-events-"));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const socket = join(dir, "pty.sock");
  const lines: Record<string, unknown>[] = [];
  const server = createServer((connection) => {
    let text = "";
    connection.on("data", (part) => (text += part.toString("utf8")));
    connection.on("end", () =>
      text
        .split("\n")
        .filter(Boolean)
        .forEach((l) => lines.push(JSON.parse(l))),
    );
  });
  t.onTestFinished(() => void server.close());
  return new Promise<{ socket: string; lines: Record<string, unknown>[] }>(
    (resolve) => server.listen(socket, () => resolve({ socket, lines })),
  );
}

function claude(name: string, extra: Record<string, unknown> = {}) {
  const payload: Record<string, any> = {
    ...fixture("claude", name),
    session_id: "claude-hosted-0001",
    ...extra,
  };
  return RUNTIMES.claude.normalize(
    payload["hook_event_name"],
    payload,
    payload["cwd"],
  )!;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

describe("a hosted runtime's hooks reporting turns to pmcp-pty", () => {
  const policy = compiled([guard("sessions.registry", "warn")]);

  it("sends turn start, and turn end with the full last message and the runtime session", async (t) => {
    const { socket, lines } = await host(t);
    const store = scratchStore();
    const pty = { socket, session: "s7", instance: "4242-1" };
    store.registry.upsert("claude-hosted-0001", {
      runtime: "claude",
      pid: process.pid,
      pty,
    });
    const long = "PTY-OK ".repeat(60).trim();
    await decide(claude("UserPromptSubmit"), policy, { store });
    await decide(claude("Stop", { last_assistant_message: long }), policy, {
      store,
    });
    await settle();
    expect(lines).toEqual([
      {
        op: "event",
        id: "s7",
        kind: "turn_start",
        session: "claude-hosted-0001",
        expect: { instance: "4242-1" },
      },
      {
        op: "event",
        id: "s7",
        kind: "turn_end",
        message: long,
        session: "claude-hosted-0001",
        expect: { instance: "4242-1" },
      },
    ]);
    // The registry keeps its short summary; the host gets the whole message.
    expect(store.registry.get("claude-hosted-0001")?.lastMessage).toHaveLength(
      200,
    );
  });

  it("sends nothing for a session no pmcp-pty host runs, and survives a host that is gone", async (t) => {
    const { socket, lines } = await host(t);
    const store = scratchStore();
    store.registry.upsert("claude-hosted-0001", {
      runtime: "claude",
      pid: process.pid,
    });
    await decide(claude("Stop"), policy, { store });
    const gone = {
      socket: join(tmpdir(), "no-such-pmcp-pty.sock"),
      session: "s1",
      instance: "1-1",
    };
    store.registry.upsert("claude-hosted-0001", { pty: gone });
    await decide(claude("Stop"), policy, { store });
    await settle();
    expect(lines).toEqual([]);
    expect(socket).toBeTruthy();
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { ptyRequest } from "../../src/harness/adapters/pty/client.js";
import { registerPtyTools } from "../../src/harness/adapters/pty/mcp.js";

type Handler = (input: unknown) => Promise<Record<string, unknown>>;

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
});

// A fake pmcp-pty: records each request line and answers ok with the op it saw.
async function fakeHost(): Promise<{
  socket: string;
  seen: Record<string, unknown>[];
}> {
  const dir = mkdtempSync(join(tmpdir(), "pmcp-pty-mcp-"));
  const socket = join(dir, "d.sock");
  const seen: Record<string, unknown>[] = [];
  const server: Server = createServer((conn) => {
    conn.on("data", (chunk) => {
      const request = JSON.parse(chunk.toString("utf8").trim()) as Record<
        string,
        unknown
      >;
      seen.push(request);
      conn.write(`${JSON.stringify({ ok: true, op: request["op"] })}\n`);
    });
  });
  await new Promise<void>((done) => server.listen(socket, done));
  cleanup.push(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { socket, seen };
}

function tools(mcpWrite: boolean, socket: string) {
  const registered = new Map<
    string,
    { config: { annotations: { readOnlyHint: boolean } }; handler: Handler }
  >();
  const server = {
    registerTool: (name: string, config: never, handler: Handler) =>
      registered.set(name, { config, handler }),
  };
  registerPtyTools(
    server as never,
    (request, limit) => ptyRequest(socket, request, limit),
    mcpWrite,
  );
  return registered;
}

describe("pmcp harness mcp", () => {
  it("offers read tools only, unless the operator policy allows writes, and never answer", async () => {
    const { socket } = await fakeHost();
    const read = tools(false, socket);
    expect([...read.keys()]).toEqual([
      "pty_describe",
      "pty_list",
      "pty_observe",
      "pty_wait",
      "pty_read",
    ]);
    const write = tools(true, socket);
    expect([...write.keys()]).toEqual([
      ...read.keys(),
      "pty_turn",
      "pty_lease",
    ]);
    expect(write.get("pty_turn")!.config.annotations.readOnlyHint).toBe(false);
    expect([...write.keys()].some((name) => name.includes("answer"))).toBe(
      false,
    );
  });

  it("marks every request via mcp and cannot override the op", async () => {
    const { socket, seen } = await fakeHost();
    const observe = tools(false, socket).get("pty_observe")!.handler;
    const result = await observe({ id: "s1", op: "answer" });
    expect(seen).toEqual([{ id: "s1", op: "observe", via: "mcp" }]);
    expect(result["structuredContent"]).toEqual({ ok: true, op: "observe" });
  });

  it("reports an unreachable host as a tool error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pmcp-pty-mcp-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const list = tools(false, join(dir, "missing.sock")).get(
      "pty_list",
    )!.handler;
    const result = await list({});
    expect(result["isError"]).toBe(true);
  });

  it("stays out of the pmcp catalog server's import graph", () => {
    const source = fileURLToPath(new URL("../../src/", import.meta.url));
    for (const file of [
      "harness/adapters/pty/mcp.ts",
      "harness/adapters/pty/client.ts",
      "commands/harness/mcp.ts",
    ]) {
      const text = readFileSync(resolve(source, file), "utf8");
      expect(text).not.toMatch(
        /from "\.\.\/(\.\.\/)*(mcp|stdio|http|server|tools\/[a-z]+)\.js"/,
      );
    }
  });
});

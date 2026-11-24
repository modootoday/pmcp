import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InMemoryTransport,
  type JSONRPCMessage,
} from "@modelcontextprotocol/server";
import { afterAll, describe, expect, it } from "vitest";

import {
  readCatalog,
  readCatalogAsync,
  type SkillEntry,
} from "../src/catalog.js";
import { createSkillServer } from "../src/mcp.js";
import { skillTree } from "./fixtures/skill-tree.js";

const root = mkdtempSync(join(tmpdir(), "pmcp-walk-open-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const modules = join(root, "node_modules");

for (const name of ["pkg-a", "pkg-b", "pkg-c"]) {
  mkdirSync(join(modules, name, "skills", "the-slug"), { recursive: true });
  writeFileSync(join(modules, name, "package.json"), JSON.stringify({ name }));
  writeFileSync(
    join(modules, name, "skills", "the-slug", "SKILL.md"),
    `---\nname: the-slug\ndescription: Use when ${name} needs it.\n---\n\nbody\n`,
  );
}

function held() {
  let release: (entries: SkillEntry[]) => void = () => {};
  const walk = new Promise<SkillEntry[]>((resolve) => {
    release = resolve;
  });
  return { walk, release: (entries: SkillEntry[]) => release(entries) };
}

async function connected(loadCatalogAsync: () => Promise<SkillEntry[]>) {
  const server = createSkillServer({ roots: [], loadCatalogAsync });
  const [client, side] = InMemoryTransport.createLinkedPair();
  const answers = new Map<number, JSONRPCMessage>();
  const waiting = new Map<number, (message: JSONRPCMessage) => void>();
  client.onmessage = (message) => {
    if (!("id" in message) || typeof message.id !== "number") return;
    answers.set(message.id, message);
    waiting.get(message.id)?.(message);
  };
  await server.connect(side);
  await client.start();
  const answer = (id: number) =>
    new Promise<JSONRPCMessage>((resolve) => {
      const done = answers.get(id);
      if (done) return resolve(done);
      waiting.set(id, resolve);
    });
  const listed = async (id: number, key: string): Promise<unknown[]> => {
    const message = (await answer(id)) as { result?: Record<string, unknown> };
    const list = message.result?.[key];
    return Array.isArray(list) ? list : [];
  };
  const send = (
    id: number,
    method: string,
    params: Record<string, unknown> = {},
  ) => client.send({ jsonrpc: "2.0", id, method, params });
  await send(1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  });
  await answer(1);
  await client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  return { send, listed, answers };
}

describe("the catalog walk does not hold other requests", () => {
  it("reads the same catalog whether it yields or not", async () => {
    expect(await readCatalogAsync({ roots: [modules] })).toEqual(
      readCatalog({ roots: [modules] }),
    );
  });

  it("lets queued callbacks run while it walks", async () => {
    let ran = 0;
    const tick = () => {
      ran += 1;
    };
    const walk = readCatalogAsync({ roots: [modules] });
    setImmediate(tick);
    await walk;
    expect(ran).toBe(1);
  });

  it("answers tools/list while resources/list and skills/list wait for the walk", async () => {
    const { walk, release } = held();
    const { send, listed, answers } = await connected(() => walk);
    await send(2, "resources/list");
    await send(3, "skills/list");
    await send(4, "tools/list");
    expect((await listed(4, "tools")).length).toBeGreaterThan(0);
    expect(answers.has(2)).toBe(false);
    expect(answers.has(3)).toBe(false);
    release(skillTree().entries);
    expect((await listed(2, "resources")).length).toBeGreaterThan(0);
    expect((await listed(3, "skills")).length).toBeGreaterThan(0);
  });
});

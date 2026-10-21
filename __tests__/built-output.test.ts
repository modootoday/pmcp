import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Shared chunks can hide imports from checks limited to an entry file.
const dir = fileURLToPath(new URL("../dist", import.meta.url));
const built = existsSync(dir)
  ? readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((name) => name.endsWith(".js"))
      .map((name) => readFileSync(join(dir, name), "utf8"))
      .join("\n")
  : null;
const describeBuilt = describe;

// Shared chunks require following imports to distinguish server and CLI dependencies.
function reachableFrom(entry: string): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  const walk = (path: string): void => {
    if (seen.has(path)) return;
    seen.add(path);
    if (!existsSync(path)) throw new Error(`Missing built module: ${path}`);
    const text = readFileSync(path, "utf8");
    parts.push(text);
    for (const m of text.matchAll(
      /(?:from\s*|import\s*\(?)["'](\.{1,2}\/[^"']+)["']/gu,
    )) {
      walk(resolve(dirname(path), m[1]!));
    }
  };
  walk(join(dir, entry));
  return parts.join("\n");
}

describeBuilt("the built bundle", () => {
  const source = built ?? "";

  it("includes every published entry and declaration", () => {
    for (const entry of ["index", "stdio", "http", "cli", "mailbox/index"]) {
      expect(existsSync(join(dir, `${entry}.js`))).toBe(true);
      expect(existsSync(join(dir, `${entry}.d.ts`))).toBe(true);
    }
    expect(built).not.toBeNull();
    // The workspace is the Rust pmcp-tui now; no TS terminal worker ships.
    expect(existsSync(join(dir, "tui-worker.js"))).toBe(false);
  });

  it("still asks for node:sqlite by its full specifier", () => {
    expect(source).toMatch(/node:\$\{"sqlite"\}|node:sqlite/u);
  });

  it("still asks for bun:sqlite by its full specifier", () => {
    expect(source).toMatch(/bun:\$\{"sqlite"\}|bun:sqlite/u);
  });

  it("never imports a bare sqlite", () => {
    expect(source).not.toMatch(/import\(\s*["'`]sqlite["'`]\s*\)/u);
  });

  it("does not inline a sqlite driver into the bundle", () => {
    expect(source).not.toContain("CREATE TABLE IF NOT EXISTS sqlite_");
  });
});

const NETWORK =
  /\bfetch\s*\(|node:http|node:https|["']undici["']|new WebSocket\b/u;

describeBuilt("the network boundary", () => {
  it.each(["index.js", "stdio.js", "mailbox/index.js"])(
    "%s cannot reach a network client",
    (entry) => {
      expect(reachableFrom(entry)).not.toMatch(NETWORK);
    },
  );

  // The CLI assertion prevents the server check from passing because networking disappeared everywhere.
  it("cli.js does reach one, so the check is measuring something", () => {
    expect(reachableFrom("cli.js")).toMatch(NETWORK);
  });
});

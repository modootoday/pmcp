import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every other test in this package exercises src/. The release gate exercises
// dist/, and the two disagreed once: esbuild rewrote `import("node:sqlite")` to
// `import("sqlite")`, which resolves nowhere, so the source had a working cache
// under node and the bundle silently had none. These assertions are about the
// bundle, and they are the only ones that would have caught it.

// Every emitted file, not just the entry: the bundler splits shared code into
// chunks, so an assertion against dist/index.js alone stops seeing the import
// the moment a second entry point is added. It did.
const dir = fileURLToPath(new URL("../dist", import.meta.url));
const built = existsSync(dir)
  ? readdirSync(dir)
      .filter((name) => name.endsWith(".js"))
      .map((name) => readFileSync(join(dir, name), "utf8"))
      .join("\n")
  : null;
const describeBuilt = built === null ? describe.skip : describe;

/**
 * What one entry point can actually reach, chunks included.
 *
 * The whole-dist assertion above is right for "is this specifier still here"
 * and wrong for "can the server reach this", because the CLI legitimately has a
 * network client and shares chunks with the server. Following the imports is
 * the only way that question stays answerable once both live in one package.
 */
function reachableFrom(entry: string): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  const walk = (name: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    const path = join(dir, name);
    if (!existsSync(path)) return;
    const text = readFileSync(path, "utf8");
    parts.push(text);
    for (const m of text.matchAll(
      /from\s*"\.\/([^"]+)"|import\("\.\/([^"]+)"\)/gu,
    )) {
      walk(m[1] ?? m[2] ?? "");
    }
  };
  walk(entry);
  return parts.join("\n");
}

describeBuilt("the built bundle", () => {
  const source = built ?? "";

  it("still asks for node:sqlite by its full specifier", () => {
    expect(source).toMatch(/node:\$\{"sqlite"\}|node:sqlite/u);
  });

  it("still asks for bun:sqlite by its full specifier", () => {
    expect(source).toMatch(/bun:\$\{"sqlite"\}|bun:sqlite/u);
  });

  // The exact rewrite that shipped a null cache: a bare `sqlite` import.
  it("never imports a bare sqlite", () => {
    expect(source).not.toMatch(/import\(\s*["'`]sqlite["'`]\s*\)/u);
  });

  it("does not inline a sqlite driver into the bundle", () => {
    expect(source).not.toContain("CREATE TABLE IF NOT EXISTS sqlite_");
  });
});

// The published promise is that the server makes no network call. The CLI now
// legitimately does, and they share chunks, so the claim is only checkable
// per entry point. This is that check, and it is the promise itself rather
// than a paraphrase of it.
const NETWORK =
  /\bfetch\s*\(|node:http|node:https|["']undici["']|new WebSocket\b/u;

describeBuilt("the network boundary", () => {
  it.each(["index.js", "stdio.js"])(
    "%s cannot reach a network client",
    (entry) => {
      expect(reachableFrom(entry)).not.toMatch(NETWORK);
    },
  );

  // Without this the assertion above passes just as well on a build where the
  // CLI lost its network client, which would mean login silently stopped working.
  it("cli.js does reach one, so the check is measuring something", () => {
    expect(reachableFrom("cli.js")).toMatch(NETWORK);
  });
});

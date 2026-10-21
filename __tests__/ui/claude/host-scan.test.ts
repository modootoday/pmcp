import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Mirrors the Claude Code 2.1.303 module scan, which refuses to load the whole mod on one miss.
const root = join(import.meta.dirname, "../../../src/ui/claude");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/u.test(entry.name) ? [path] : [];
  });
}

describe("the Claude mod passes the host's static scan", () => {
  it("reads and updates host state only through an atom declared in the same file", () => {
    const misses: string[] = [];
    for (const file of sources(root)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(
        /\b(?:read|update|write)\(\s*\$\s*,\s*(\w+)/gu,
      )) {
        const local = new RegExp(`const ${match[1]} = atom\\(`, "u");
        if (!local.test(text)) misses.push(`${file}: ${match[0]}`);
      }
    }
    expect(misses).toEqual([]);
  });

  it("names every hooked event with a string literal", () => {
    const misses: string[] = [];
    for (const file of sources(root)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\bon\(\s*([^\s,)]+)/gu))
        if (!/^"[a-z.]+"$/u.test(match[1]!))
          misses.push(`${file}: ${match[0]}`);
    }
    expect(misses).toEqual([]);
  });

  it("names a self-contained state contract that declares every kept key", () => {
    const plugin = join(root, "../../../plugins/pmcp");
    const manifest = JSON.parse(
      readFileSync(join(plugin, ".claude-plugin/plugin.json"), "utf8"),
    );
    expect(manifest.types).toBe("./mod/contract.d.ts");
    const contract = readFileSync(join(plugin, "mod/contract.d.ts"), "utf8");
    expect(contract).not.toMatch(
      /^\s*(?:import|export .* from|\/\/\/ <reference)/mu,
    );
    expect(contract).not.toMatch(/^type /mu);
    expect(contract).toMatch(/pmcp: \{\s*kept:/u);
  });
});

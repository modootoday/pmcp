import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const source = fileURLToPath(new URL("../src/", import.meta.url));

function dependencies(entry: string): Set<string> {
  const visited = new Set<string>();
  const queue = [resolve(source, entry)];
  while (queue.length > 0) {
    const path = queue.pop()!;
    if (visited.has(path)) continue;
    visited.add(path);
    const content = readFileSync(path, "utf8");
    for (const match of content.matchAll(
      /(?:\bfrom\s*|\bimport\s*\()\s*["'](\.[^"']+)["']/g,
    )) {
      const target = resolve(dirname(path), match[1]!.replace(/\.js$/, ".ts"));
      if (existsSync(target)) queue.push(target);
    }
  }
  return visited;
}

it.each(["index.ts", "stdio.ts", "http.ts", "mailbox/index.ts"])(
  "%s cannot reach native supervision through its import graph",
  (entry) => {
    const paths = [...dependencies(entry)];
    expect(
      paths.filter((path) => path.startsWith(resolve(source, "harness") + "/")),
    ).toEqual([]);
    expect(paths.some((path) => path.endsWith("commands/harness.ts"))).toBe(
      false,
    );
    expect(
      paths.filter((path) => path.startsWith(resolve(source, "tui") + "/")),
    ).toEqual([]);
    expect(paths.some((path) => path.endsWith("commands/tui.ts"))).toBe(false);
  },
);

it("makes native supervision reachable through the CLI only", () => {
  const paths = dependencies("cli.ts");
  expect(paths.has(resolve(source, "harness/application/invoke.ts"))).toBe(
    true,
  );
  expect(paths.has(resolve(source, "harness/adapters/tmux/lifecycle.ts"))).toBe(
    true,
  );
  expect(paths.has(resolve(source, "tui/application/invoke.ts"))).toBe(true);
});

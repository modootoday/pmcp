/** A catalog on disk: skills with text, binary and invalid-UTF-8 files, per tier. */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { SkillEntry } from "../../src/catalog.js";

export const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
export const WASM = Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00]);
export const LATIN1 = Uint8Array.from([0x63, 0x61, 0x66, 0xe9, 0x0a]);

function write(path: string, data: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

export interface SkillTree {
  readonly root: string;
  readonly entries: SkillEntry[];
}

/** Two skills: an open one carrying every file kind, and a paid one. */
export function skillTree(): SkillTree {
  const root = mkdtempSync(join(tmpdir(), "pmcp-tree-"));
  const dir = (slug: string) => join(root, slug);
  write(
    join(dir("kit"), "SKILL.md"),
    "---\nname: kit\ndescription: >-\n  Builds things,\n  in two lines.\n---\n\nSee references/guide.md.\n",
  );
  write(join(dir("kit"), "references/guide.md"), "# Guide\n");
  write(join(dir("kit"), "scripts/run.py"), "print('ok')\n");
  write(join(dir("kit"), "assets/logo.png"), PNG);
  write(join(dir("kit"), "assets/engine.wasm"), WASM);
  write(join(dir("kit"), "assets/notes.md"), LATIN1);
  write(
    join(dir("vault"), "SKILL.md"),
    "---\nname: vault\ndescription: Paid only.\n---\n\nSecret.\n",
  );
  write(join(dir("vault"), "references/secret.md"), "classified\n");
  const entry = (slug: string, tier: string): SkillEntry => ({
    name: `mp/plug/${slug}`,
    package: "mp/plug",
    slug,
    description: slug === "kit" ? "Builds things, in two lines." : "Paid only.",
    path: join(dir(slug), "SKILL.md"),
    tier,
  });
  return { root, entries: [entry("kit", "open"), entry("vault", "paid")] };
}

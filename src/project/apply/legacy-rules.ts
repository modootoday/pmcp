import { existsSync, rmSync } from "node:fs";
import { join, posix } from "node:path";

import type { Output } from "../outputs.js";
import { legacyLinks, RULES_DIR } from "../package-rules.js";
import type { ProjectSpec } from "../spec.js";

export function pruneLegacyRules(
  spec: ProjectSpec,
  outputs: readonly Output[],
): number {
  if (!spec.packageRules) return 0;
  const linkedDirs = new Set(
    outputs
      .filter(
        (o) =>
          o.kind === "link" &&
          o.path.startsWith(`${RULES_DIR}/${spec.packageRules?.dir}/`),
      )
      .map((o) =>
        o.kind === "link"
          ? posix.dirname(o.target.replace(/^(\.\.\/)+/u, ""))
          : "",
      ),
  );
  let pruned = 0;
  for (const [name, target] of legacyLinks(spec.root)) {
    const abs = join(spec.root, RULES_DIR, `${name}.md`);
    const broken = !existsSync(abs);
    if (!broken && !linkedDirs.has(posix.dirname(target))) continue;
    rmSync(abs, { force: true });
    pruned += 1;
  }
  return pruned;
}

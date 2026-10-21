import { globSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

function contains(root: string, target: string): boolean {
  const rest = relative(root, target);
  return !isAbsolute(rest) && rest !== ".." && !rest.startsWith(`..${sep}`);
}

function owner(validator: string): string {
  const parts = validator.split(sep);
  const at = parts.findIndex((part) => part === ".agents" || part === ".agent");
  return at < 0 ? dirname(validator) : parts.slice(0, at).join(sep) || sep;
}

export function validators(
  root: string,
  pattern: string,
  paths: readonly string[],
): string[] {
  const realRoot = realpathSync(root);
  const edits = paths
    .map((path) => resolve(path))
    .filter((path) => contains(root, path));
  if (edits.length === 0) return [];
  const candidates = [
    ...globSync(pattern, {
      cwd: root,
      exclude: ["**/node_modules/**", "**/.git/**"],
    }),
  ]
    .map((path) => resolve(root, path))
    .filter((path) => {
      if (!contains(realRoot, realpathSync(path)) || !statSync(path).isFile())
        return false;
      return edits.some((edit) => contains(owner(path), edit));
    });
  return [
    ...new Set(
      candidates.filter((candidate) =>
        edits.some((edit) => {
          const base = owner(candidate);
          if (!contains(base, edit)) return false;
          return !candidates.some(
            (other) =>
              owner(other).length > base.length && contains(owner(other), edit),
          );
        }),
      ),
    ),
  ].sort();
}

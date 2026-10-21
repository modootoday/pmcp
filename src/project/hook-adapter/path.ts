import { existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
export function guardPath(root: string, command: readonly string[]): string {
  const script = command[0]?.startsWith(".agents/guards/")
    ? command[0]
    : command[1];
  if (!script?.startsWith(".agents/guards/")) {
    throw new Error("Hook command must execute a script under .agents/guards/");
  }
  const absolute = resolve(root, script);
  const base = resolve(root, ".agents/guards");
  const inside = relative(base, absolute);
  if (
    isAbsolute(inside) ||
    inside === ".." ||
    inside.startsWith("../") ||
    inside.startsWith("..\\")
  ) {
    throw new Error("Hook guard must stay under .agents/guards/");
  }
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new Error("Hook guard script must exist");
  }
  const actual = relative(base, realpathSync(absolute));
  if (
    isAbsolute(actual) ||
    actual === ".." ||
    actual.startsWith("../") ||
    actual.startsWith("..\\")
  ) {
    throw new Error("Hook guard cannot resolve outside .agents/guards/");
  }
  return absolute;
}

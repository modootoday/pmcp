import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkoutOf } from "../sessions/checkout.js";
import { distance } from "../git/landed.js";

const SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;

function read(path: string): string {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}

function ref(commonDir: string, name: string): string {
  if (!name.startsWith("refs/") || name.split("/").includes("..")) return "";
  const loose = read(join(commonDir, name));
  if (SHA.test(loose)) return loose;
  for (const line of read(join(commonDir, "packed-refs")).split("\n")) {
    const [sha, path] = line.split(" ");
    if (path === name && sha && SHA.test(sha)) return sha;
  }
  return "";
}

export function counts(path: string, upstream: string) {
  const checkout = checkoutOf(path);
  if (checkout) {
    const head = read(join(checkout.gitDir, "HEAD"));
    const tip = head.startsWith("ref: ")
      ? ref(checkout.commonDir, head.slice(5))
      : head;
    const target = ref(checkout.commonDir, "refs/remotes/" + upstream);
    // Equal tips need no graph walk, keeping current desks cheap to inspect.
    if (SHA.test(tip) && tip === target) return { ahead: 0, behind: 0 };
  }
  return distance(path, upstream);
}

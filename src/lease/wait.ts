import { existsSync, readFileSync, readdirSync } from "node:fs";

import { pidAlive } from "./files.js";

// Conditions are data, never shell: a loop around pgrep matches its own shell, and a loop
// around read -t burns a core.

export type Condition =
  | { readonly kind: "pid"; readonly pid: number }
  | { readonly kind: "exists"; readonly path: string }
  | { readonly kind: "gone"; readonly path: string }
  | { readonly kind: "load-below"; readonly max: number }
  | { readonly kind: "no-process"; readonly text: string };

export const CONDITION_FORMS =
  "exists:<path> | gone:<path> | load-below:<n> | no-process:<text>";

export function parseCondition(text: string): Condition | null {
  const at = text.indexOf(":");
  if (at <= 0) return null;
  const kind = text.slice(0, at);
  const value = text.slice(at + 1);
  if (value === "") return null;
  if (kind === "exists" || kind === "gone") return { kind, path: value };
  if (kind === "no-process") return { kind, text: value };
  if (kind === "load-below") {
    const max = Number(value);
    return max > 0 ? { kind, max } : null;
  }
  return null;
}

function ancestors(proc: string): Set<number> {
  const found = new Set<number>();
  for (let pid = process.pid, hops = 0; pid > 1 && hops < 64; hops += 1) {
    found.add(pid);
    try {
      const stat = readFileSync(`${proc}/${pid}/stat`, "utf8");
      pid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
    } catch {
      break;
    }
  }
  return found;
}

// This process and the shells that started it name the text too; they never count.
export function processMatching(text: string, proc = "/proc"): number | null {
  const own = ancestors(proc);
  let names: string[];
  try {
    names = readdirSync(proc);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!/^\d+$/u.test(name) || own.has(Number(name))) continue;
    try {
      const line = readFileSync(`${proc}/${name}/cmdline`, "utf8");
      if (line.split("\0").join(" ").includes(text)) return Number(name);
    } catch {
      // Gone between the listing and the read.
    }
  }
  return null;
}

function load1(file: string): number | null {
  try {
    return Number(readFileSync(file, "utf8").split(" ")[0]);
  } catch {
    return null;
  }
}

export function met(condition: Condition, loadavg = "/proc/loadavg"): boolean {
  switch (condition.kind) {
    case "pid":
      return condition.pid === process.pid || !pidAlive(condition.pid);
    case "exists":
      return existsSync(condition.path);
    case "gone":
      return !existsSync(condition.path);
    case "load-below": {
      const load = load1(loadavg);
      return load === null || load < condition.max;
    }
    case "no-process":
      return processMatching(condition.text) === null;
  }
}

export interface WaitOptions {
  readonly conditions: readonly Condition[];
  readonly timeout: number;
  readonly interval: number;
  readonly loadavg?: string;
  readonly say: (line: string) => void;
}

// Every condition must hold at once; sleeps between checks, so a long wait costs nothing.
export async function waitFor(options: WaitOptions): Promise<boolean> {
  const deadline = Date.now() + options.timeout * 1000;
  for (;;) {
    if (options.conditions.every((c) => met(c, options.loadavg))) return true;
    const left = deadline - Date.now();
    if (left <= 0) return false;
    const step = Math.min(options.interval * 1000, left);
    await new Promise((resolve) => setTimeout(resolve, step));
  }
}

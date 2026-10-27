// Native hook entries pmcp does not own still run in every session, so a broken one fails each
// call it matches. Each entry's command must name a script that exists; a script run directly
// must also be executable and start with a shebang. Commands are parsed, never run.

import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { HOOK_DIRECTORY } from "../hooks/compiled.js";

// Files whose hooks a runtime reads, with { event: [{ hooks: [{ command }] }] } under "hooks".
const SETTINGS = [
  ".claude/settings.json",
  ".claude/settings.local.json",
  ".codex/hooks.json",
];

// Programs that take the script as their first non-option argument.
const INTERPRETERS = new Set([
  "node",
  "bun",
  "deno",
  "tsx",
  "python",
  "python3",
  "bash",
  "sh",
  "zsh",
  "dash",
  "ruby",
  "perl",
]);

export interface HookProblem {
  readonly file: string;
  readonly event: string;
  readonly command: string;
  readonly problem: string;
}

function commands(value: unknown): { event: string; command: string }[] {
  const hooks = (value as Record<string, unknown> | null)?.["hooks"];
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) return [];
  const found: { event: string; command: string }[] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const entries = (group as Record<string, unknown> | null)?.["hooks"];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const command = (entry as Record<string, unknown> | null)?.["command"];
        if (typeof command === "string") found.push({ event, command });
      }
    }
  }
  return found;
}

// Shell words of the first simple command: quotes kept together, stops at an operator.
export function firstWords(command: string): string[] {
  const words: string[] = [];
  let word = "";
  let quote: string | null = null;
  let started = false;
  for (const char of command) {
    if (quote) {
      if (char === quote) quote = null;
      else word += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/u.test(char)) {
      if (started) words.push(word);
      word = "";
      started = false;
      continue;
    }
    if (";|&<>()".includes(char)) break;
    word += char;
    started = true;
  }
  if (started) words.push(word);
  return words;
}

type Expanded = { path: string } | { skip: true } | { problem: string };

function expand(
  word: string,
  vars: Readonly<Record<string, string | undefined>>,
): Expanded {
  let unknown: string | null = null;
  const path = word
    .replace(/^~(?=\/|$)/u, vars["HOME"] ?? "~")
    .replace(/\$\{(\w+)\}|\$(\w+)/gu, (_, braced, bare) => {
      const name = (braced ?? bare) as string;
      const value = vars[name];
      if (value === undefined) unknown ??= name;
      return value ?? "";
    });
  if (unknown === "CLAUDE_PLUGIN_ROOT")
    return { problem: "${CLAUDE_PLUGIN_ROOT} outside a plugin" };
  if (unknown !== null) return { skip: true };
  return { path };
}

function scriptProblem(path: string, direct: boolean): string | null {
  if (!existsSync(path)) return "the script does not exist";
  if (!statSync(path).isFile()) return "the script is not a file";
  if (!direct) return null;
  try {
    accessSync(path, constants.X_OK);
  } catch {
    return "the script is not executable";
  }
  const head = readFileSync(path).subarray(0, 2).toString("latin1");
  if (head !== "#!") return "the script has no shebang";
  return null;
}

// The problem with one command, or null when it is fine or names a program on PATH.
export function commandProblem(
  command: string,
  cwd: string,
  vars: Readonly<Record<string, string | undefined>>,
): string | null {
  const words = firstWords(command).filter(
    (word, index, all) =>
      !(
        /^\w+=/u.test(word) &&
        all.slice(0, index).every((w) => /^\w+=/u.test(w))
      ),
  );
  const program = words[0];
  if (program === undefined) return "the command is empty";
  const base = program.slice(program.lastIndexOf("/") + 1);
  let target = program;
  let direct = true;
  if (INTERPRETERS.has(base)) {
    const script = words.slice(1).find((word) => !word.startsWith("-"));
    // An interpreter given code inline (node -e) or nothing names no file.
    if (script === undefined || words.slice(1).some((w) => /^-[ec]$/u.test(w)))
      return null;
    target = script;
    direct = false;
  }
  if (!target.includes("/") && !target.includes("$")) return null;
  const expanded = expand(target, vars);
  if ("skip" in expanded) return null;
  if ("problem" in expanded) return expanded.problem;
  const path = isAbsolute(expanded.path)
    ? expanded.path
    : resolve(cwd, expanded.path);
  return scriptProblem(path, direct);
}

function readHooksFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

// Plugins kept in the repository: each tracked .claude-plugin/plugin.json and its hooks file.
function pluginHookFiles(root: string): { file: string; plugin: string }[] {
  const listed = spawnSync(
    "git",
    ["ls-files", "-z", "--", ":(glob)**/.claude-plugin/plugin.json"],
    { cwd: root, encoding: "utf8" },
  );
  if (listed.status !== 0) return [];
  const found: { file: string; plugin: string }[] = [];
  for (const manifest of listed.stdout.split("\0").filter(Boolean)) {
    const plugin = dirname(dirname(join(root, manifest)));
    const declared = (
      readHooksFile(join(root, manifest)) as Record<string, unknown> | null
    )?.["hooks"];
    const file = resolve(
      plugin,
      typeof declared === "string" ? declared : "hooks/hooks.json",
    );
    if (existsSync(file)) found.push({ file, plugin });
  }
  return found;
}

export function unmanagedHookProblems(
  root: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): HookProblem[] {
  return unmanagedHooks(root, env).problems;
}

// How many entries pmcp does not own were checked, and what is wrong with them.
export function unmanagedHooks(
  root: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): { checked: number; problems: HookProblem[] } {
  let checked = 0;
  const sources = [
    ...SETTINGS.map((file) => ({ file: join(root, file), plugin: undefined })),
    ...pluginHookFiles(root),
  ];
  const problems: HookProblem[] = [];
  for (const source of sources) {
    if (!existsSync(source.file)) continue;
    const vars = {
      ...env,
      CLAUDE_PROJECT_DIR: root,
      CLAUDE_PLUGIN_ROOT: source.plugin,
    };
    for (const { event, command } of commands(readHooksFile(source.file))) {
      if (command.includes(`${HOOK_DIRECTORY}/`)) continue;
      checked += 1;
      const problem = commandProblem(command, root, vars);
      if (problem)
        problems.push({
          file: relative(root, source.file),
          event,
          command,
          problem,
        });
    }
  }
  return { checked, problems };
}

export function describeHookProblem(problem: HookProblem): string {
  return `${problem.file} ${problem.event}: ${problem.command}: ${problem.problem}`;
}

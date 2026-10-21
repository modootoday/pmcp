import { readFileSync } from "node:fs";

import { ancestors } from "../../sessions/liveness.js";

// Markers a coding agent or pmcp-pty leaves in the environment of what it runs. A same-user
// process can drop them, so this check stops instructed agents and accidents, nothing more.
const ENV_MARKERS = [
  "PMCP_PTY_SOCKET",
  "PMCP_PTY_SESSION",
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CODEX_THREAD_ID",
  "CODEX_SANDBOX",
  "GEMINI_CLI",
  "GROK_SESSION_ID",
  "AI_AGENT",
];

const RUNTIMES = new Set([
  "claude",
  "codex",
  "gemini",
  "grok",
  "opencode",
  "agy",
  "pmcp-pty",
]);
// Runtimes started through node show up by their package path, not their process name.
const PACKAGES =
  /@openai\/codex|@google\/gemini-cli|opencode-ai|@anthropic-ai\/claude-code/u;

export interface ProcessView {
  readonly name: string;
  readonly cmdline: string;
}

function view(pid: number): ProcessView | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const name = stat.slice(stat.indexOf("(") + 1, stat.lastIndexOf(")"));
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll(
      "\0",
      " ",
    );
    return { name, cmdline };
  } catch {
    return null;
  }
}

function agentProcess(p: ProcessView): boolean {
  const first = p.cmdline.split(" ")[0] ?? "";
  const base = first.slice(first.lastIndexOf("/") + 1);
  return RUNTIMES.has(p.name) || RUNTIMES.has(base) || PACKAGES.test(p.cmdline);
}

/** Why this process looks like it runs under an agent or pmcp-pty, or null. */
export function agentContext(
  env: Readonly<Record<string, string | undefined>>,
  chain: readonly ProcessView[] = ancestors().flatMap((pid) => view(pid) ?? []),
): string | null {
  const marker = ENV_MARKERS.find((name) => env[name] !== undefined);
  if (marker) return `${marker} is set`;
  const agent = chain.find(agentProcess);
  return agent ? `it runs under ${agent.name}` : null;
}

export interface TerminalEntry {
  readonly stdin: boolean;
  readonly stdout: boolean;
  readonly term?: string;
  readonly ci?: string;
}

export function interactiveEntry(terminal: TerminalEntry): boolean {
  if (!terminal.stdin || !terminal.stdout) return false;
  if (!terminal.term || terminal.term === "dumb") return false;
  return !terminal.ci || terminal.ci === "false" || terminal.ci === "0";
}

export function entryMode(
  terminal: TerminalEntry,
): "server" | "terminal" | "help" {
  if (!terminal.stdin || !terminal.stdout) return "server";
  if (!interactiveEntry(terminal)) return "help";
  return "terminal";
}

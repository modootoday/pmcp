import type { Tool } from "../spec.js";
export interface RunResult {
  readonly missing: boolean;
  readonly status: number | null;
  readonly stdout: string;
}
export type Runner = (
  command: string,
  args: readonly string[],
  cwd: string,
  env?: Readonly<Record<string, string | undefined>>,
) => RunResult;
export type Status = "ok" | "fail" | "warn" | "skip";
export interface Finding {
  readonly tool: Tool | "project";
  readonly check: string;
  readonly status: Status;
  readonly detail?: string;
}
export interface DoctorOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly run: Runner;
  readonly home: string;
  readonly only?: ReadonlySet<Tool>;
}
export interface GrokInspect {
  projectTrusted?: boolean;
  projectInstructions?: {
    path: string;
  }[];
  skills?: {
    name: string;
  }[];
  mcpServers?: {
    name: string;
  }[];
}

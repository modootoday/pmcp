// Hotpath bridge invoking the compiled native hook binary with graceful TS fallback.

import {
  accessSync,
  constants,
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

import type { CompiledPolicy } from "./compiled.js";
import type { Decision, Verdict } from "./contract.js";

export interface NativeEvalRequest {
  readonly runtime: string;
  readonly event: string;
  readonly command?: string;
  readonly mainline_branch?: string;
  readonly mainlineBranch?: string;
  readonly tool?: {
    readonly command?: string;
  };
}

export interface NativeHookResponse {
  readonly verdict: "allow" | "deny" | "ask" | "warn" | string;
  readonly guard?: string;
  readonly reason?: string;
  readonly delegate: boolean;
}

export interface EvaluateNativeHookOptions {
  readonly binaryPath?: string | null;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs?: number;
  readonly policyPath?: string;
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

// Locate the native binary through override variable, platform package, local cargo build, or PATH.
export function resolveNativeHookBinary(
  env: Readonly<Record<string, string | undefined>> = process.env,
  customCandidates: readonly string[] = [],
): string | null {
  const given = env["PMCP_HOOK_BIN"];
  if (given !== undefined) {
    const trimmed = given.trim();
    return trimmed && isExecutable(trimmed) ? trimmed : null;
  }

  const exe = process.platform === "win32" ? "pmcp-hook.exe" : "pmcp-hook";

  try {
    const req = createRequire(import.meta.url);
    const platform = `pmcp-${process.platform}-${process.arch}`;
    const manifest = req.resolve(`@modootoday/${platform}/package.json`);
    const packaged = join(dirname(manifest), "bin", exe);
    if (isExecutable(packaged)) return packaged;
  } catch {
    // Optional platform package is omitted during dev or on unsupported platforms.
  }

  const candidates = [
    join(import.meta.dirname, "../../crates/pmcp-hook/target/release", exe),
    join(import.meta.dirname, "../../crates/pmcp-hook/target/debug", exe),
    ...customCandidates,
  ];

  for (const candidate of candidates) {
    if (isExecutable(candidate)) return candidate;
  }

  const pathDirs = (env["PATH"] ?? "").split(delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    const candidate = join(dir, exe);
    if (isExecutable(candidate)) return candidate;
  }

  return null;
}

// Evaluate policy via native hook stdin/stdout JSON, returning null on missing binary, delegation, or error.
export function evaluateNativeHook(
  policy: CompiledPolicy | string,
  request: NativeEvalRequest,
  options: EvaluateNativeHookOptions = {},
): NativeHookResponse | null {
  const binary =
    options.binaryPath !== undefined
      ? options.binaryPath
      : resolveNativeHookBinary(options.env ?? process.env);
  if (!binary) return null;

  let policyPath = options.policyPath;
  let tempDir: string | null = null;

  if (!policyPath) {
    if (typeof policy === "string" && existsSync(policy)) {
      policyPath = policy;
    } else {
      // Serialize in-memory policy to disk so the native process can read it via CLI argument.
      tempDir = mkdtempSync(join(tmpdir(), "pmcp-hook-"));
      policyPath = join(tempDir, "policy.json");
      const json = typeof policy === "string" ? policy : JSON.stringify(policy);
      writeFileSync(policyPath, json, "utf8");
    }
  }

  const command =
    request.command !== undefined ? request.command : request.tool?.command;
  const branch = request.mainline_branch ?? request.mainlineBranch;

  const payload: Record<string, unknown> = {
    runtime: request.runtime,
    event: request.event,
    ...(command !== undefined ? { command } : {}),
    ...(branch ? { mainline_branch: branch } : {}),
  };

  try {
    const proc = spawnSync(binary, [policyPath], {
      input: JSON.stringify(payload),
      encoding: "utf8",
      timeout: options.timeoutMs ?? 2000,
      env: (options.env ?? process.env) as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (proc.status !== 0 || proc.error) return null;

    const rawOut = proc.stdout?.trim();
    if (!rawOut) return null;

    const parsed = JSON.parse(rawOut) as NativeHookResponse;
    if (parsed.delegate) return null;

    return parsed;
  } catch {
    return null;
  } finally {
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Prevent temp cleanup errors from failing the hotpath evaluation.
      }
    }
  }
}

export const evalNativeHook = evaluateNativeHook;

// Translate native hook output into neutral Decision format when needed.
export function toDecision(response: NativeHookResponse): Decision {
  if (response.verdict === "allow") return {};
  if (response.verdict === "warn") {
    const note = response.guard
      ? `pmcp ${response.guard}: ${response.reason ?? "would refuse this call"}`
      : (response.reason ?? "warning");
    return { context: [note] };
  }
  const verdict: Verdict = response.verdict === "ask" ? "ask" : "deny";
  return {
    verdict,
    ...(response.reason ? { reason: response.reason } : {}),
  };
}

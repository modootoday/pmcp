import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, relative } from "node:path";

import { agentContext, type ProcessView } from "./agent-context.js";
import { expandPath } from "./paths.js";

// The operator governs the agent sessions. Every session runs as the same user, so this keeps
// instructed agents and accidents away from operator verbs; a hard boundary needs the agents
// under another user, which a token file readable only by the operator then gives.

export const OPERATOR_TOKEN_ENV = "PMCP_OPERATOR_TOKEN";

export type OperatorSettings =
  | { readonly via: "tty" }
  | { readonly via: "token"; readonly tokenFile: string };

export interface OperatorProbe {
  readonly env: Readonly<Record<string, string | undefined>>;
  // Whether standard input is an interactive terminal.
  readonly tty: boolean;
  readonly chain?: readonly ProcessView[];
}

export type OperatorVerdict =
  { readonly ok: true } | { readonly ok: false; readonly why: string };

function fail(message: string): never {
  throw new Error(`[sessions.operator] ${message}`);
}

export function readOperatorSettings(
  sessions: unknown,
  root: string,
): OperatorSettings {
  const table = (sessions as Record<string, unknown> | undefined)?.["operator"];
  if (table === undefined) return { via: "tty" };
  if (table === null || typeof table !== "object" || Array.isArray(table))
    fail("must be a table");
  const raw = table as Record<string, unknown>;
  const unknown = Object.keys(raw).find(
    (key) => key !== "via" && key !== "token_file",
  );
  if (unknown) fail(`unknown key ${unknown}`);
  const via = raw["via"] ?? "tty";
  if (via === "tty") {
    if (raw["token_file"] !== undefined)
      fail('token_file goes with via = "token"');
    return { via };
  }
  if (via !== "token") fail('via must be "tty" or "token"');
  const given = raw["token_file"];
  if (typeof given !== "string" || given === "")
    fail('via = "token" needs token_file, a path outside the project');
  if (
    !given.startsWith("~") &&
    !given.startsWith("$HOME/") &&
    !isAbsolute(given)
  )
    fail("token_file must be absolute or start with ~/");
  const tokenFile = expandPath(root, given);
  const inside = relative(root, tokenFile);
  if (!inside.startsWith("..") && !isAbsolute(inside))
    fail(
      "token_file must be outside the project, where agents' edits do not reach",
    );
  return { via, tokenFile };
}

function digest(text: string): Buffer {
  return createHash("sha256").update(text.trim()).digest();
}

function tokenCheck(file: string, given: string | undefined): OperatorVerdict {
  if (!given) return { ok: false, why: `${OPERATOR_TOKEN_ENV} is not set` };
  let mode: number;
  let expected: string;
  try {
    mode = statSync(file).mode;
    expected = readFileSync(file, "utf8");
  } catch {
    return { ok: false, why: `the operator token file ${file} cannot be read` };
  }
  if ((mode & 0o077) !== 0)
    return {
      ok: false,
      why: `the operator token file ${file} is readable by others; chmod 600 it`,
    };
  if (!expected.trim())
    return { ok: false, why: `the operator token file ${file} is empty` };
  return timingSafeEqual(digest(given), digest(expected))
    ? { ok: true }
    : {
        ok: false,
        why: `${OPERATOR_TOKEN_ENV} does not match the operator token`,
      };
}

export function operatorCheck(
  settings: OperatorSettings,
  probe: OperatorProbe,
): OperatorVerdict {
  if (settings.via === "token")
    return tokenCheck(settings.tokenFile, probe.env[OPERATOR_TOKEN_ENV]);
  const agent = agentContext(probe.env, probe.chain);
  if (agent)
    return { ok: false, why: `it runs inside an agent session (${agent})` };
  if (!probe.tty)
    return {
      ok: false,
      why: "the operator runs it from an interactive terminal, and standard input is not one",
    };
  return { ok: true };
}

export class OperatorOnly extends Error {
  constructor(verb: string, why: string) {
    super(
      `${verb} is the operator's to run: ${why}. Ask the operator to run it from their own terminal (in your reply, or with pmcp sessions send --to alias:operator where the mailbox is on).`,
    );
    this.name = "OperatorOnly";
  }
}

export function requireOperator(
  verb: string,
  settings: OperatorSettings,
  probe: OperatorProbe,
): void {
  const verdict = operatorCheck(settings, probe);
  if (!verdict.ok) throw new OperatorOnly(verb, verdict.why);
}

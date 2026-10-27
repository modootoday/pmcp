import type { Decision, ShellStep } from "../../contract.js";
import { program, realSteps, shellCall } from "../_shared.js";
import { onlyKeys, pass, stringList, type Policy } from "../types.js";
import { fileOperands } from "./operands.js";

export interface ValueCommand {
  readonly binary: string;
  readonly verbs: readonly (readonly string[])[];
}

export interface SecretOptions {
  readonly secretPaths: readonly RegExp[];
  readonly valueCommands: readonly ValueCommand[];
  readonly publishCommands: readonly ValueCommand[];
}

// Exclude checked-in templates and public keys so secret-path rules do not block public inputs.
const SECRET_PATHS = [
  /(?:^|[^\w.-])\.env(?:\.(?!example\b|sample\b|template\b|dist\b)[\w.-]+)?(?![\w.-])/iu,
  /\.dev\.vars(?:\.json)?\b/iu,
  /\b(?:id_rsa|id_ed25519|id_ecdsa)\b(?!\.pub)/u,
  /\.(?:pem|p12|pfx)\b/iu,
  // Known credential files only: a name that merely contains "secret" (a test fixture, a
  // policy source) is not one. Project-specific files go in extra_secret_paths.
  /\.(?:npmrc|netrc)\b/u,
  /\bauth\.json\b/u,
  /\bservice[-_]?account[\w.-]*\.json\b/iu,
];
const READERS = new Set(
  "cat bat head tail less more nl tac od xxd hexdump strings base64 cut tee cp awk gawk sed grep egrep rg ag jq yq python python3 perl ruby node bun deno".split(
    " ",
  ),
);
const NETWORK = new Set(
  "curl wget nc ncat netcat socat telnet ssh scp rsync ftp http httpie xh".split(
    " ",
  ),
);
const URL = /^[^\s]*https?:\/\//u;
// Treat escaped search patterns separately so they do not masquerade as file paths.
const PATTERN = /\\[.\w]/u;
const ENV_DUMPS = [
  ["printenv"],
  ["env"],
  ["set"],
  ["export", "-p"],
  ["declare", "-x"],
];
const FALLBACK_PATH = /(?:^|[^\w.-])\.env(?![.\w-])|\.dev\.vars(?:\.json)?\b/u;
const FALLBACK_USE =
  /(?:^|[;&|(]|&&)\s*(?:sudo\s+)?(?:cat|head|tail|less|grep|rg|jq|base64|cp|curl|wget|nc|scp|rsync)\b/u;
const NO_VALUES =
  "Use metadata verbs instead (ls, stat, wc, find), or a command that names keys without resolving values.";

function names(word: string, options: SecretOptions): boolean {
  if (PATTERN.test(word)) return false;
  return [...SECRET_PATHS, ...options.secretPaths].some((re) => re.test(word));
}

function isWire(word: string): boolean {
  return NETWORK.has(program(word)) || URL.test(word);
}

function runsVerb(
  argv: readonly string[],
  commands: readonly ValueCommand[],
): boolean {
  return commands.some((entry) =>
    argv.some((word, at) => {
      if (program(word) !== entry.binary) return false;
      const end = argv.indexOf("--", at + 1);
      const args = argv.slice(at + 1, end < 0 ? undefined : end);
      return entry.verbs.some((verb) => {
        let from = 0;
        for (const part of verb) {
          const found = args.indexOf(part, from);
          if (found < 0) return false;
          from = found + 1;
        }
        return true;
      });
    }),
  );
}

function dumpsEnvironment(step: ShellStep): boolean {
  return ENV_DUMPS.some(
    (dump) =>
      step.raw.length === dump.length &&
      dump.every((word, at) => step.raw[at] === word),
  );
}

// A credential-like path given as the value of a configuration option is handed to the program
// as its config, not printed: npm-cli.js install --userconfig empty.npmrc reads nothing out.
const CONFIG_OPTION = /^--(?:[\w-]*config|rcfile|[\w-]*rc)$/u;

function configValues(argv: readonly string[]): string[] {
  const values: string[] = [];
  for (let at = 1; at < argv.length; at += 1) {
    const [flag, inline] = argv[at]!.split(/=(.*)/su);
    if (!CONFIG_OPTION.test(flag!)) continue;
    if (inline !== undefined) values.push(argv[at]!, inline);
    else if (argv[at + 1] !== undefined) values.push(argv[(at += 1)]!);
  }
  return values;
}

// File operands of a step, less the config option values (each removed once).
function operandsOf(argv: readonly string[]): string[] {
  const operands = [...fileOperands(argv)];
  for (const value of configValues(argv)) {
    const at = operands.indexOf(value);
    if (at >= 0) operands.splice(at, 1);
  }
  return operands;
}

type Severity = "read" | "exfil";

function severity(
  steps: readonly ShellStep[],
  options: SecretOptions,
): Severity | null {
  const wire = steps.some((step) => step.raw.some(isWire));
  const real = realSteps(steps);
  if (real.some((step) => runsVerb(step.argv, options.publishCommands)))
    return "exfil";
  if (real.some((step) => runsVerb(step.argv, options.valueCommands)))
    return wire ? "exfil" : "read";
  if (steps.some(dumpsEnvironment)) return wire ? "exfil" : "read";
  const touched = real.filter((step) =>
    operandsOf(step.argv).some((word) => names(word, options)),
  );
  if (touched.some((step) => isWire(step.argv[0]!))) return "exfil";
  if (!touched.some((step) => READERS.has(program(step.argv[0])))) return null;
  return wire ? "exfil" : "read";
}

function fallbackSeverity(command: string): Severity | null {
  if (!FALLBACK_PATH.test(command) || !FALLBACK_USE.test(command)) return null;
  return /\b(?:curl|wget|nc|scp|rsync)\b|https?:\/\//u.test(command)
    ? "exfil"
    : "read";
}

function verbsOf(table: Record<string, unknown>, key: string): string[][] {
  return (stringList(table, key) ?? []).map((verb) => verb.split(/\s+/u));
}

function commandTables(raw: unknown): {
  value: ValueCommand[];
  publish: ValueCommand[];
} {
  if (raw === undefined) return { value: [], publish: [] };
  if (!Array.isArray(raw))
    throw new Error("value_commands must be an array of tables");
  const value: ValueCommand[] = [];
  const publish: ValueCommand[] = [];
  for (const entry of raw as unknown[]) {
    const table = (entry ?? {}) as Record<string, unknown>;
    onlyKeys(table, ["binary", "read", "publish"]);
    const binary = table["binary"];
    if (typeof binary !== "string" || binary === "") {
      throw new Error("value_commands entries need a binary");
    }
    value.push({ binary, verbs: verbsOf(table, "read") });
    publish.push({ binary, verbs: verbsOf(table, "publish") });
  }
  return { value, publish };
}

export const secretExfiltration: Policy<SecretOptions> = {
  id: "shell.secret_exfiltration",
  events: ["before_tool"],
  tools: ["shell"],
  fail: "closed",
  defaultMode: "graded",
  options(raw) {
    onlyKeys(raw, ["extra_secret_paths", "value_commands"]);
    const commands = commandTables(raw["value_commands"]);
    return {
      secretPaths: (stringList(raw, "extra_secret_paths") ?? []).map(
        (source) => new RegExp(source, "iu"),
      ),
      valueCommands: commands.value,
      publishCommands: commands.publish,
    };
  },

  evaluate(input, ctx): Decision {
    const call = shellCall(input);
    if (!call) return pass;
    const found = call.steps
      ? severity(call.steps, ctx.options)
      : fallbackSeverity(call.command);
    if (found === "exfil") {
      return {
        verdict: "deny",
        reason:
          "This sends a credential, or changes a live one, over the network. Credential values must not leave the host; send a reference, never the material.",
      };
    }
    if (found === "read") {
      return {
        verdict: "ask",
        reason: `This prints credential values to stdout, where they enter the transcript and every log that carries it. ${NO_VALUES}`,
      };
    }
    return pass;
  },
};

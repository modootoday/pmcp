import { program } from "../_shared.js";

// Which words of a reading command name files it reads. A search pattern, a sed or awk script,
// a jq filter or inline interpreter code only mentions a path, so a pattern such as
// "\.env\|key" is not a read of .env (two live false positives, 2026-10-20).
interface Grammar {
  // Options whose next word is code or a pattern, not a file.
  readonly code: readonly string[];
  // Options whose next word is a file the program reads.
  readonly files: readonly string[];
  // Options whose next word is some other value.
  readonly values: readonly string[];
  // The first operand is code unless a code or file option already supplied it.
  readonly leadingCode: boolean;
}

const SEARCH: Grammar = {
  code: ["-e", "--regexp"],
  files: ["-f", "--file"],
  values: [
    "-m",
    "--max-count",
    "-A",
    "-B",
    "-C",
    "--context",
    "-g",
    "--glob",
    "-t",
    "--type",
    "--include",
    "--exclude",
    "--exclude-dir",
  ],
  leadingCode: true,
};
const GRAMMARS: Readonly<Record<string, Grammar>> = {
  grep: SEARCH,
  egrep: SEARCH,
  rg: SEARCH,
  ag: SEARCH,
  sed: {
    code: ["-e", "--expression"],
    files: ["-f", "--file"],
    values: [],
    leadingCode: true,
  },
  awk: { code: [], files: ["-f"], values: ["-v", "-F"], leadingCode: true },
  gawk: { code: [], files: ["-f"], values: ["-v", "-F"], leadingCode: true },
  jq: {
    code: [],
    files: ["-f", "--from-file", "--rawfile", "--slurpfile"],
    values: ["--arg", "--argjson"],
    leadingCode: true,
  },
  yq: { code: [], files: ["--from-file"], values: [], leadingCode: true },
};
const INLINE = new Set([
  "python",
  "python3",
  "perl",
  "ruby",
  "node",
  "bun",
  "deno",
]);
const INLINE_CODE = new Set(["-c", "-e", "-E", "-p", "--eval", "--print"]);

function grammarOf(name: string): Grammar | null {
  if (GRAMMARS[name]) return GRAMMARS[name]!;
  if (INLINE.has(name))
    return {
      code: [...INLINE_CODE],
      files: [],
      values: [],
      leadingCode: false,
    };
  return null;
}

export function fileOperands(argv: readonly string[]): readonly string[] {
  const grammar = grammarOf(program(argv[0]));
  if (!grammar) return argv.slice(1);
  const operands: string[] = [];
  let codeGiven = false;
  let options = true;
  for (let at = 1; at < argv.length; at += 1) {
    const word = argv[at]!;
    const [flag, inline] =
      word.startsWith("--") && word.includes("=")
        ? word.split(/=(.*)/su)
        : [word, undefined];
    if (options && word === "--") {
      options = false;
      continue;
    }
    if (options && grammar.code.includes(flag!)) {
      codeGiven = true;
      if (inline === undefined) at += 1;
      continue;
    }
    if (options && grammar.files.includes(flag!)) {
      codeGiven = true;
      operands.push(inline ?? argv[at + 1] ?? "");
      if (inline === undefined) at += 1;
      continue;
    }
    if (options && grammar.values.includes(flag!)) {
      // jq --arg and --argjson take a name and a value.
      if (inline === undefined)
        at += flag === "--arg" || flag === "--argjson" ? 2 : 1;
      continue;
    }
    if (options && word.startsWith("-") && word !== "-") continue;
    if (grammar.leadingCode && !codeGiven) {
      codeGiven = true;
      continue;
    }
    operands.push(word);
  }
  return operands;
}

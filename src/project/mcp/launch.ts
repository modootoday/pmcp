import type { McpServerSpec } from "../spec.js";
import { ProjectError } from "../package-rules.js";
import { ROOT_VAR, VARIABLE } from "./_shared.js";
import type { LaunchSpec } from "./types.js";
const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

function shellWord(text: string): string {
  const pieces: string[] = [];
  let offset = 0;
  for (const match of text.matchAll(VARIABLE)) {
    const literal = text.slice(offset, match.index);
    if (literal !== "") {
      pieces.push(quote(literal));
    }
    const name = match[1]!;
    if (name === "PROJECT_ROOT") {
      pieces.push('"$d"');
    } else {
      pieces.push(`"\${${name}:?${name} is required}"`);
    }
    offset = match.index + match[0].length;
  }
  const tail = text.slice(offset);
  if (tail !== "") {
    pieces.push(quote(tail));
  }
  if (pieces.length === 0) {
    return "''";
  }
  return pieces.join("");
}

export function forwardedVariables(server: McpServerSpec): string[] {
  const names = new Set(server.envVars ?? []);
  const words = [
    server.command ?? "",
    ...server.args,
    ...Object.values(server.env),
    server.cwd ?? "",
  ];
  for (const word of words) {
    for (const match of word.matchAll(VARIABLE)) {
      if (match[1] !== "PROJECT_ROOT") {
        names.add(match[1]!);
      }
    }
  }
  return [...names].sort();
}

export function launch(spec: McpServerSpec): LaunchSpec {
  if (spec.command === undefined) {
    throw new ProjectError("An HTTP server cannot be launched as stdio");
  }
  const words = [
    spec.command,
    ...spec.args,
    ...Object.values(spec.env),
    spec.cwd ?? "",
  ];
  const variables = forwardedVariables(spec);
  const needsRoot = words.some((word) => word.includes(ROOT_VAR));
  const needsExpansion = words.some(
    (word) => [...word.matchAll(VARIABLE)].length > 0,
  );
  if (!needsExpansion && !spec.cwd && variables.length === 0) {
    return { command: spec.command, args: spec.args, env: spec.env };
  }
  const statements: string[] = [];
  if (needsRoot) {
    statements.push(
      [
        // The real directory: an inherited $PWD can name a directory the runtime has left.
        "d=$(pwd -P)",
        'while [ ! -f "$d/pmcp.toml" ]',
        "do",
        '  [ "$d" = / ] && exit 1',
        '  d=$(dirname "$d")',
        "done",
      ].join("\n"),
    );
  }
  for (const name of variables) {
    statements.push(`export ${name}="\${${name}:?${name} is required}"`);
  }
  for (const [key, value] of Object.entries(spec.env)) {
    statements.push(`export ${key}=${shellWord(value)}`);
  }
  if (spec.cwd) {
    statements.push(`cd ${shellWord(spec.cwd)} || exit 1`);
  }
  statements.push(
    `exec ${[spec.command, ...spec.args].map(shellWord).join(" ")}`,
  );
  return { command: "sh", args: ["-c", statements.join("\n")], env: {} };
}

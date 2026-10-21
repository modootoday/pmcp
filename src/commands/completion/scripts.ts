import type { CommandSpec, OptionSpec } from "../../cli/command.js";

export const SHELLS = ["bash", "zsh", "fish"] as const;
export type Shell = (typeof SHELLS)[number];

const GLOBAL_FLAGS = ["-q", "--quiet", "--no-color", "--color", "--help"];

function flags(command: CommandSpec): string[] {
  const own = (command.options ?? []).map((option) => `--${option.name}`);
  return [...own, ...GLOBAL_FLAGS];
}

function bash(commands: readonly CommandSpec[]): string {
  const verbs = commands.map((command) => command.name);
  const cases = commands.map(
    (command) => `    ${command.name}) words="${flags(command).join(" ")}" ;;`,
  );
  return [
    "_pmcp() {",
    '  local cur="${COMP_WORDS[COMP_CWORD]}"',
    "  local words",
    '  if [ "$COMP_CWORD" -eq 1 ]; then',
    `    words="${[...verbs, ...GLOBAL_FLAGS, "--version"].join(" ")}"`,
    "  else",
    '    case "${COMP_WORDS[1]}" in',
    ...cases,
    `    *) words="${GLOBAL_FLAGS.join(" ")}" ;;`,
    "    esac",
    "  fi",
    '  COMPREPLY=( $(compgen -W "$words" -- "$cur") )',
    "}",
    "complete -F _pmcp pmcp",
    "",
  ].join("\n");
}

function zshQuote(text: string): string {
  return `'${text.replaceAll("'", "'\\''").replaceAll(":", "\\:")}'`;
}

function zsh(commands: readonly CommandSpec[]): string {
  const verbs = commands.map((command) =>
    zshQuote(`${command.name}:${command.describe}`),
  );
  const cases = commands.map(
    (command) =>
      `    ${command.name}) compadd -- ${flags(command).join(" ")} ;;`,
  );
  return [
    "#compdef pmcp",
    "_pmcp() {",
    "  if (( CURRENT == 2 )); then",
    "    local -a verbs",
    `    verbs=(${verbs.join(" ")})`,
    "    _describe command verbs",
    `    compadd -- ${[...GLOBAL_FLAGS, "--version"].join(" ")}`,
    "    return",
    "  fi",
    "  case $words[2] in",
    ...cases,
    `    *) compadd -- ${GLOBAL_FLAGS.join(" ")} ;;`,
    "  esac",
    "}",
    'if [ "$funcstack[1]" = "_pmcp" ]; then',
    '  _pmcp "$@"',
    "else",
    "  compdef _pmcp pmcp",
    "fi",
    "",
  ].join("\n");
}

function fishQuote(text: string): string {
  return `'${text.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function fishOption(command: CommandSpec, option: OptionSpec): string {
  const value = option.boolean === true ? "" : " -r";
  return `complete -c pmcp -n '__fish_seen_subcommand_from ${command.name}' -l ${option.name}${value} -d ${fishQuote(option.describe)}`;
}

function fish(commands: readonly CommandSpec[]): string {
  const verbs = commands.map(
    (command) =>
      `complete -c pmcp -n __fish_use_subcommand -a ${command.name} -d ${fishQuote(command.describe)}`,
  );
  const options = commands.flatMap((command) =>
    (command.options ?? []).map((option) => fishOption(command, option)),
  );
  return [
    "complete -c pmcp -f",
    ...verbs,
    "complete -c pmcp -n __fish_use_subcommand -l version -d 'print the version'",
    "complete -c pmcp -s q -l quiet -d 'only errors'",
    "complete -c pmcp -l no-color -d 'never colour output'",
    "complete -c pmcp -l color -d 'always colour output'",
    "complete -c pmcp -s h -l help -d 'help for pmcp or one command'",
    ...options,
    "",
  ].join("\n");
}

const RENDER: Record<Shell, (commands: readonly CommandSpec[]) => string> = {
  bash,
  zsh,
  fish,
};

export function completionScript(
  shell: Shell,
  commands: readonly CommandSpec[],
): string {
  return RENDER[shell](commands);
}

# src/commands rules

- `registry.ts` is the only list of verbs. An entry spreads a spec from `specs/` and
  loads its module with a dynamic import; nothing else imports a command module.
- A spec holds name, describe, usage and options as plain data. It imports only
  `cli/command.ts` types, `options/`, and other data-only modules, never a module
  that reads files, parses config or pulls a dependency.
- A command module spreads its spec and adds `run`; help and completion read the
  spec, so a flag cannot be declared in one place and parsed in another.
- `--version`, top-level help, command help and completion never load a command
  module. `__tests__/cli-startup.test.ts` holds the entry graph to that.
- A verb with independent subcommands loads each one with its own dynamic import,
  as `project.ts` does for `exec-mcp`, which runs once per MCP server launch.
- Exit codes come from `EXIT` in `cli/command.ts`; their published meaning is in
  `docs/commands.md` (Exit codes), which a new code or flag must update.
- `index.ts`, `dispatch.ts` and `registry.ts` assemble; logic belongs in a command
  module or the domain it calls.

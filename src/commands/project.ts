import { homedir } from "node:os";

import {
  ArgumentError,
  many,
  one,
  type Command,
  type CommandContext,
} from "../cli/command.js";
import { project } from "../project/apply.js";
import { planMcpImport, writeMcpImport } from "../project/mcp-import.js";
import { execMcp } from "../project/mcp-env.js";
import { doctor, spawnRunner, type Finding } from "../project/doctor.js";
import { memoryFindings } from "../project/memory.js";
import { addEntry, findEntry, removeAsset } from "../project/edit.js";
import { ProjectError } from "../project/package-rules.js";
import {
  readSpec,
  TOOLS,
  type ProjectSpec,
  type Tool,
} from "../project/spec.js";
import { CATALOG_OPTIONS, catalogFrom, configFrom } from "./roots.js";

function specFrom(context: CommandContext): ProjectSpec {
  const config = configFrom(context);
  if (config === null) {
    throw new ArgumentError(
      "no pmcp.toml at or above this directory; pass --config <file>",
    );
  }
  try {
    return readSpec(config);
  } catch (error) {
    throw new ArgumentError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

function reproject(context: CommandContext, spec: ProjectSpec): number {
  const result = project(spec, { check: false });
  for (const problem of result.problems) context.ui.error(problem);
  if (result.code !== 0) {
    return 1;
  }
  if (result.backup) {
    context.ui.info("backup", result.backup);
  }
  context.ui.success(
    `projected ${result.outputs} outputs`,
    result.pruned > 0 ? `pruned ${result.pruned}` : undefined,
  );
  return 0;
}

function importMcp(context: CommandContext): number {
  const config = configFrom(context);
  if (config === null) {
    throw new ArgumentError("MCP import needs an existing pmcp.toml");
  }
  const sources = many(context.args, "source");
  if (sources.length === 0) {
    throw new ArgumentError("import-mcp needs --source <tool>:<file>");
  }
  const plan = planMcpImport(config.path, sources, many(context.args, "name"));
  context.ui.table(
    plan.entries.map((entry) => [
      `${entry.status}  ${entry.alias}`,
      entry.detail ?? entry.source,
    ]),
  );
  if (
    plan.entries.some(
      (entry) => entry.status === "blocked" || entry.status === "conflict",
    )
  ) {
    return 1;
  }
  if (!context.args.flags.has("write")) {
    context.ui.info(
      "preview",
      "No files written. Use --write to import, then pmcp project to project.",
    );
    return 0;
  }
  if (Object.keys(plan.additions).length === 0) {
    context.ui.success("all selected servers already match");
    return 0;
  }
  const backup = writeMcpImport(plan);
  context.ui.info("backup", backup);
  context.ui.success(
    `imported ${Object.keys(plan.additions).length} MCP servers`,
    "pmcp project applies them",
  );
  return 0;
}

export const projectCommand: Command = {
  name: "project",
  describe: "Write each agent tool's native files from .agents/ and pmcp.toml",
  usage:
    "pmcp project [--check] | pmcp project add <skill|agent> | pmcp project remove <name> | pmcp project import-mcp --source <tool>:<file> [--name <alias>] [--write]",
  options: [
    ...CATALOG_OPTIONS,
    {
      name: "source",
      describe:
        "Explicit native MCP source as <tool>:<file>. Repeatable; import-mcp only.",
      repeat: true,
      placeholder: "<tool>:<file>",
    },
    {
      name: "name",
      describe: "Import only this MCP alias. Repeatable; import-mcp only.",
      repeat: true,
      placeholder: "<alias>",
    },
    {
      name: "write",
      describe:
        "Back up and import the reviewed MCP declarations; import-mcp only.",
      boolean: true,
    },
    {
      name: "check",
      describe:
        "Write nothing; exit 2 when an output drifted, went stale or is undeclared.",
      boolean: true,
    },
  ],
  async run(context) {
    const [verb, name, ...extra] = context.args.positional;
    if (extra.length > 0) {
      throw new ArgumentError(`unexpected ${extra.join(" ")}`);
    }
    try {
      if (verb === "exec-mcp") {
        if (
          name === undefined ||
          context.args.flags.has("check") ||
          context.args.flags.has("write") ||
          many(context.args, "source").length > 0 ||
          many(context.args, "name").length > 0
        ) {
          throw new ArgumentError("exec-mcp takes only a declared stdio alias");
        }
        return await execMcp(specFrom(context), name, context.env);
      }
      if (verb === "import-mcp") {
        if (name !== undefined || context.args.flags.has("check")) {
          throw new ArgumentError(
            "import-mcp takes --source, --name and --write; no positional name or --check",
          );
        }
        return importMcp(context);
      }
      if (
        many(context.args, "source").length > 0 ||
        one(context.args, "name") !== undefined ||
        context.args.flags.has("write")
      ) {
        throw new ArgumentError(
          "--source, --name and --write require import-mcp",
        );
      }
      if (verb === undefined) {
        const spec = specFrom(context);
        if (!context.args.flags.has("check")) {
          return reproject(context, spec);
        }
        const result = project(spec, { check: true });
        for (const problem of result.problems) context.ui.error(problem);
        if (result.code !== 0) {
          context.ui.info(
            "fix",
            "pmcp project (edit .agents/ or pmcp.toml, never the outputs)",
          );
          return 2;
        }
        context.ui.success(`${result.outputs} outputs match`);
        return 0;
      }
      if (context.args.flags.has("check")) {
        throw new ArgumentError("--check takes no subcommand");
      }
      if (name === undefined) {
        throw new ArgumentError(`${verb} needs a name`);
      }
      if (verb === "add") {
        const spec = specFrom(context);
        const added = addEntry(
          spec.root,
          findEntry(catalogFrom(context), name),
        );
        context.ui.success(`added ${added.kind} ${added.name}`, added.path);
        return reproject(context, specFrom(context));
      }
      if (verb === "remove") {
        const spec = specFrom(context);
        for (const path of removeAsset(spec.root, name)) {
          context.ui.success("removed", path);
        }
        return reproject(context, specFrom(context));
      }
      throw new ArgumentError(`unknown subcommand ${verb}`);
    } catch (error) {
      if (error instanceof ProjectError) {
        context.ui.error(error.message);
        return 1;
      }
      throw error;
    }
  },
};

const MARKS: Record<Finding["status"], string> = {
  ok: "ok",
  fail: "FAIL",
  skip: "skip",
};

export const doctorCommand: Command = {
  name: "doctor",
  describe:
    "Ask each agent tool, through its own listing commands, whether it loads this project's assets",
  usage: "pmcp doctor [--tool <name>] [--json] [--memory]",
  options: [
    {
      name: "config",
      describe: "A pmcp.toml to read instead of the nearest one.",
      placeholder: "<file>",
    },
    {
      name: "tool",
      describe: `Check only this tool (${TOOLS.join(", ")}). Repeatable.`,
      repeat: true,
      placeholder: "<name>",
    },
    { name: "json", describe: "Emit JSON rather than a table.", boolean: true },
    {
      name: "memory",
      describe:
        "Report native memory configuration metadata only; do not read memory bodies or check MCP connections.",
      boolean: true,
    },
  ],
  run(context) {
    const only = many(context.args, "tool");
    for (const tool of only) {
      if (!(TOOLS as readonly string[]).includes(tool))
        throw new ArgumentError(`unknown tool ${tool}`);
    }
    const options = {
      run: spawnRunner,
      home: context.env["HOME"] ?? homedir(),
      env: context.env,
      ...(only.length > 0 ? { only: new Set(only as Tool[]) } : {}),
    };
    const spec = specFrom(context);
    const findings = context.args.flags.has("memory")
      ? memoryFindings(spec, options)
      : doctor(spec, options);
    if (context.args.flags.has("json")) {
      context.ui.data(`${JSON.stringify({ findings }, null, 2)}\n`);
    } else {
      context.ui.table(
        findings.map((f) => [
          `${MARKS[f.status]}  ${f.tool}`,
          f.detail ? `${f.check} (${f.detail})` : f.check,
        ]),
      );
    }
    return findings.some((f) => f.status === "fail") ? 1 : 0;
  },
};

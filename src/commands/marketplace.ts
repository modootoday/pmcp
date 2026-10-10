import { resolve } from "node:path";
import { ArgumentError, one, type Command } from "../cli/command.js";
import { publicMarketplaceRoot } from "../marketplace/builtin.js";
import {
  exportPublicPlugin,
  isNativePluginRuntime,
  publicPlugins,
} from "../marketplace/export.js";

export const marketplaceCommand: Command = {
  name: "marketplace",
  describe: "List free public plugins or export a selected native plugin",
  usage:
    "pmcp marketplace list | export <plugin> --runtime <runtime> --output <directory> [--json]",
  options: [
    {
      name: "runtime",
      describe: "Native plugin format: claude, codex, gemini, grok or agy.",
      placeholder: "<runtime>",
    },
    {
      name: "output",
      describe:
        "New directory for the selected plugin; existing paths are preserved.",
      placeholder: "<directory>",
    },
    {
      name: "json",
      describe: "Print machine-readable results.",
      boolean: true,
    },
  ],
  run(context) {
    const [verb, name, ...extra] = context.args.positional;
    const root = publicMarketplaceRoot();
    if (verb === "list") {
      if (
        name ||
        extra.length ||
        one(context.args, "runtime") ||
        one(context.args, "output")
      )
        throw new ArgumentError(
          "marketplace list takes no plugin or export options",
        );
      const plugins = publicPlugins(root).map((plugin) => ({
        name: plugin.name,
        version: plugin.manifest.version,
        description: plugin.manifest.description,
      }));
      if (context.args.flags.has("json")) {
        context.ui.data(
          `${JSON.stringify({ marketplace: "pmcp", plugins }, null, 2)}\n`,
        );
        return 0;
      }
      context.ui.table(
        plugins.map((plugin) => [
          plugin.name,
          String(plugin.description ?? ""),
        ]),
      );
      return 0;
    }
    if (verb !== "export" || !name || extra.length)
      throw new ArgumentError(
        "Use marketplace list or export with exactly one plugin",
      );
    const output = one(context.args, "output");
    if (!output)
      throw new ArgumentError("Provide --output for the exported plugin");
    const runtime = one(context.args, "runtime");
    if (!isNativePluginRuntime(runtime))
      throw new ArgumentError(
        "Choose --runtime claude, codex, gemini, grok or agy",
      );
    const result = exportPublicPlugin(
      root,
      name,
      runtime,
      resolve(context.cwd, output),
    );
    if (context.args.flags.has("json")) {
      context.ui.data(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    }
    context.ui.success(
      `Exported ${name} for ${runtime} to ${result.output}; install with the native plugin manager`,
    );
    return 0;
  },
};

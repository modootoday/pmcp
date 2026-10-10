import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  containedPath,
  readLocalMarketplace,
  type LocalPlugin,
} from "./local.js";

export const NATIVE_PLUGIN_RUNTIMES = [
  "claude",
  "codex",
  "gemini",
  "grok",
  "agy",
] as const;
export type NativePluginRuntime = (typeof NATIVE_PLUGIN_RUNTIMES)[number];

export function isNativePluginRuntime(
  value: string | undefined,
): value is NativePluginRuntime {
  return NATIVE_PLUGIN_RUNTIMES.includes(value as NativePluginRuntime);
}

export function publicPlugins(root: string): readonly LocalPlugin[] {
  const rejected: string[] = [];
  const marketplace = readLocalMarketplace(root, (item) =>
    rejected.push(item.reason),
  );
  if (!marketplace || rejected.length)
    throw new Error(`Invalid public marketplace: ${rejected.join("; ")}`);
  return marketplace.plugins;
}

function readResources(
  directory: string,
  prefix: string,
  files: Map<string, Buffer>,
): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink())
      throw new Error("Plugin exports cannot contain symlinks");
    const path = join(directory, entry.name);
    const relativePath = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      if (relativePath.split("/").length > 6)
        throw new Error("Plugin resources exceed the supported depth");
      readResources(path, relativePath, files);
      continue;
    }
    if (!entry.isFile())
      throw new Error("Plugin resources must be regular files");
    const stats = lstatSync(path);
    if (stats.size > 1024 * 1024 || files.size >= 256)
      throw new Error("Plugin resources exceed the export budget");
    files.set(relativePath, readFileSync(path));
  }
}

export function pluginExportFiles(
  root: string,
  name: string,
  runtime: NativePluginRuntime,
): Map<string, Buffer> {
  const plugin = publicPlugins(root).find((item) => item.name === name);
  if (!plugin) throw new Error("No such public plugin");
  const files = new Map<string, Buffer>();
  readResources(containedPath(plugin.directory, "skills"), "skills", files);
  for (const name of ["LICENSE", "NOTICE"])
    files.set(name, readFileSync(containedPath(root, name)));
  const manifests: Record<NativePluginRuntime, readonly string[]> = {
    claude: [".claude-plugin/plugin.json", ".mcp.json"],
    codex: ["plugin.json", "mcp.json"],
    gemini: ["gemini-extension.json"],
    grok: [".claude-plugin/plugin.json", ".mcp.json"],
    agy: [],
  };
  for (const filename of manifests[runtime]) {
    if (existsSync(join(plugin.directory, filename)))
      files.set(
        filename,
        readFileSync(containedPath(plugin.directory, filename)),
      );
  }
  if (runtime === "agy") {
    files.set(
      "plugin.json",
      Buffer.from(
        `${JSON.stringify({ name: plugin.name, description: plugin.manifest.description }, null, 2)}\n`,
      ),
    );
    const mcp = join(plugin.directory, ".mcp.json");
    if (existsSync(mcp))
      files.set(
        "mcp_config.json",
        readFileSync(containedPath(plugin.directory, mcp)),
      );
  }
  return files;
}

export function exportPublicPlugin(
  root: string,
  name: string,
  runtime: NativePluginRuntime,
  output: string,
): {
  plugin: string;
  runtime: NativePluginRuntime;
  output: string;
  files: number;
} {
  const destination = resolve(output);
  const files = pluginExportFiles(root, name, runtime);
  mkdirSync(dirname(destination), { recursive: true });
  try {
    mkdirSync(destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(
        "Export destination already exists; choose a new directory",
      );
    throw error;
  }
  for (const [path, bytes] of files) {
    const target = join(destination, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes, { flag: "wx" });
  }
  return { plugin: name, runtime, output: destination, files: files.size };
}

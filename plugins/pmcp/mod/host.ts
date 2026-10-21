import { parseUiSettings, UI_SETTINGS_FILE } from "./reader/index";
import type { StateFiles, UiSettings } from "./reader/index";

export function hostFiles($: any): StateFiles {
  return {
    exists: async (path) => Boolean(await $.fs.exists(path)),
    read: async (path) => String(await $.fs.read(path)),
    list: async (directory) => {
      const entries = (await $.fs.list(directory).catch(() => [])) as any[];
      return entries.map((entry) => String(entry.name));
    },
  };
}

// Ask the projected hook for state location so mod and hook readers cannot diverge.
export async function resolveStateDir(
  $: any,
  root: string,
  settings: UiSettings,
): Promise<string> {
  if (settings.stateDir) return settings.stateDir;
  const hook = `${root}/.agents/pmcp-hooks/hook.mjs`;
  if (!(await $.fs.exists(hook))) return "";
  const run = await $.process
    .run(["node", hook, "--state-dir"])
    .catch(() => null);
  if (!run || run.exitCode !== 0) return "";
  return String(run.stdout).trim();
}

export async function findSettings(
  $: any,
  cwd: string,
): Promise<{ root: string; settings: UiSettings } | null> {
  let directory = cwd.replace(/\/+$/, "");
  while (directory) {
    const path = `${directory}/${UI_SETTINGS_FILE}`;
    if (await $.fs.exists(path)) {
      const source = String(await $.fs.read(path).catch(() => ""));
      const settings = parseUiSettings(source, directory);
      return settings ? { root: directory, settings } : null;
    }
    directory = directory.replace(/\/[^/]*$/, "");
  }
  return null;
}

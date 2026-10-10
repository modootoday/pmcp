import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Receipt } from "../contracts.js";
import { GroupStore } from "./store.js";
import { stateDirectory } from "../adapters/tmux/records.js";

export function listGroups(): Receipt {
  const directory = stateDirectory();
  if (!existsSync(directory)) return { groups: [] };
  const groups = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(directory, entry.name, "group.json");
    if (!existsSync(path)) continue;
    try {
      const store = new GroupStore(path);
      groups.push({ groupFile: store.path, group: store.state.group });
    } catch {
      groups.push({ groupFile: path, observed: "unavailable" });
    }
  }
  return { groups };
}

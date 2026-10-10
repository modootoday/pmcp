import { dirname } from "node:path";
import { openBackend, type Backend } from "../adapters/tmux/backend.js";
import { GroupStore } from "../groups/store.js";

export interface GroupContext {
  store: GroupStore;
  backend: Backend;
}

export function openGroup(path: string): GroupContext {
  const store = new GroupStore(path);
  const backend = openBackend(dirname(store.path));
  if (store.state.group.owner !== backend.owner)
    throw new Error("foreign_group");
  return { store, backend };
}

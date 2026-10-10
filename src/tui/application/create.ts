import { join } from "node:path";
import { realpathSync } from "node:fs";
import { planLayout } from "../../harness/terminal/layout.js";
import { GroupStore } from "../../harness/groups/store.js";
import { quote } from "../../harness/adapters/process/command.js";
import { runtime } from "../adapters/process/runtime.js";
import { ViewConnection } from "../adapters/tmux/connection.js";
import { TmuxView } from "../adapters/tmux/view.js";
import { createDirectory, saveView } from "../state/store.js";
import { CommonHarness } from "./common.js";
import type { CreateInput, View } from "../contracts.js";

export async function createView(input: CreateInput) {
  const plan = planLayout(input.columns, input.rows);
  const helpers = runtime();
  const mailbox = input.mailbox
    ? {
        config: realpathSync(input.mailbox.config),
        actorFile: realpathSync(input.mailbox.actorFile),
      }
    : undefined;
  const groupFile = realpathSync(input.groupFile);
  const group = new GroupStore(groupFile).state.group;
  const common = new CommonHarness({
    groupFile,
    generation: group.generation,
    groupOwner: group.owner,
  });
  const observed = await common.snapshot();
  const main = observed.sessions.find(
    (session) => session.role === "main" && session.alive,
  );
  if (!main) throw new Error("view_requires_live_main");
  const { directory, owner } = createDirectory();
  const file = join(directory, "view.json");
  const connection = new ViewConnection(directory, owner);
  const argv = [helpers.node, helpers.worker, "attach", file, main.id];
  const result = connection
    .raw([
      "new-session",
      "-d",
      "-x",
      String(plan.columns),
      "-y",
      String(plan.rows),
      "-s",
      "pmcp-a",
      "-P",
      "-F",
      "#{session_id}|#{window_id}|#{pane_id}",
      `exec ${argv.map(quote).join(" ")}`,
    ])
    .split("|");
  connection.raw(["set-option", "-g", "@pmcp-tui-owner", owner]);
  const view: View = {
    schemaVersion: 1,
    owner,
    directory,
    groupFile,
    generation: group.generation,
    groupOwner: group.owner,
    mainId: main.id,
    target: main.id,
    state: "open",
    phase: "read-only",
    plan,
    ...helpers,
    session: result[0]!,
    window: result[1]!,
    mainPane: result[2]!,
    serverIdentity: connection.serverIdentity(),
    ...(mailbox ? { mailbox } : {}),
  };
  saveView(file, view);
  const renderer = new TmuxView(view, file);
  try {
    renderer.configure();
    renderer.resize(view, plan);
    renderer.status(view);
    saveView(file, view);
    return { schemaVersion: 1, ok: true, viewFile: file, view };
  } catch (error) {
    renderer.connection.cleanup();
    view.state = "closed";
    saveView(file, view);
    throw error;
  }
}

import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { privateJson, readPrivateJson } from "../../harness/groups/store.js";
import { object, text } from "../../harness/validation.js";
import { planLayout } from "../../harness/terminal/layout.js";
import type { View } from "../contracts.js";

export function createDirectory(): { directory: string; owner: string } {
  const root = join(
    process.env.XDG_STATE_HOME ?? join(homedir(), ".local/state"),
    "pmcp/tui",
  );
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const directory = join(realpathSync(root), randomUUID().slice(0, 16));
  if (Buffer.byteLength(join(directory, "s")) > 100)
    throw new Error("socket_path_too_long");
  mkdirSync(directory, { mode: 0o700 });
  const owner = randomUUID();
  privateJson(join(directory, "owner.json"), {
    owner,
    createdAt: new Date().toISOString(),
  });
  writeFileSync(
    join(directory, "tmux.conf"),
    [
      "set -g remain-on-exit on",
      "set -g history-limit 2000",
      "set -g default-terminal tmux-256color",
      "set -g status off",
      "set -g mouse off",
      "set -g destroy-unattached off",
      "",
    ].join("\n"),
    { flag: "wx", mode: 0o600 },
  );
  return { directory, owner };
}

export function readView(path: string): { file: string; view: View } {
  const file = realpathSync(path);
  const directory = dirname(file);
  const stat = lstatSync(directory);
  if (
    !stat.isDirectory() ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o077) !== 0
  )
    throw new Error("unsafe_view_directory");
  const value = object(readPrivateJson(file));
  const metadata = object(readPrivateJson(join(directory, "owner.json")));
  if (
    value.schemaVersion !== 1 ||
    value.directory !== directory ||
    value.owner !== metadata.owner
  )
    throw new Error("foreign_view_owner");
  for (const key of [
    "owner",
    "groupFile",
    "generation",
    "groupOwner",
    "mainId",
    "target",
    "node",
    "worker",
  ])
    text(value[key], key);
  if (!["open", "closed"].includes(String(value.state)))
    throw new Error("invalid_view_state");
  if (
    ![
      "read-only",
      "acquiring",
      "connecting",
      "controlled",
      "releasing",
      "uncertain",
    ].includes(String(value.phase))
  )
    throw new Error("invalid_control_phase");
  const plan = object(value.plan);
  planLayout(Number(plan.columns), Number(plan.rows));
  for (const [key, pattern] of [
    ["session", /^\$\d+$/],
    ["window", /^@\d+$/],
    ["mainPane", /^%\d+$/],
    ["serverIdentity", /^\d+:\d+$/],
  ] as const) {
    if (!pattern.test(text(value[key], key)))
      throw new Error("invalid_view_identity");
  }
  const view = value as unknown as View;
  const fallback = join(directory, "callback-failure.json");
  if (existsSync(fallback)) {
    const recorded = object(readPrivateJson(fallback));
    const failure = object(recorded.failure);
    if (
      recorded.owner !== view.owner ||
      typeof failure.code !== "string" ||
      !/^[a-z][a-z0-9_]{0,79}$/.test(failure.code)
    )
      throw new Error("invalid_view_failure");
    if (!view.failure || String(failure.at) >= view.failure.at)
      view.failure = failure as unknown as View["failure"];
  }
  return { file, view };
}

export function dismissFailure(file: string, view: View): void {
  const fallback = join(view.directory, "callback-failure.json");
  if (existsSync(fallback)) unlinkSync(fallback);
  delete view.failure;
  saveView(file, view);
}

export function saveView(file: string, view: View): void {
  privateJson(file, view);
}

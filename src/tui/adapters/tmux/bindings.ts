import { quote } from "../../../harness/adapters/process/command.js";
import type { View } from "../../contracts.js";
import type { ViewConnection } from "./connection.js";

export function callback(
  view: View,
  file: string,
  action: string,
  args: string[] = [],
): string {
  return [
    view.node,
    view.worker,
    "action",
    action,
    "--view",
    file,
    "--callback",
    ...args,
  ]
    .map(quote)
    .join(" ");
}

export function bindKeys(
  connection: ViewConnection,
  view: View,
  file: string,
): void {
  connection.command(["set-option", "-g", "prefix", "C-g"]);
  connection.command(["unbind-key", "-a"]);
  connection.command(["bind-key", "C-g", "send-prefix"]);
  for (const [key, action] of [
    ["m", "main"],
    ["w", "observe"],
    ["c", "control"],
    ["r", "release"],
    ["h", "history"],
    ["b", "mailbox"],
    ["d", "detach"],
    ["!", "dismiss"],
    ["g", "management"],
  ])
    connection.command([
      "bind-key",
      key!,
      "run-shell",
      "-b",
      callback(view, file, action!),
    ]);
  for (let index = 1; index <= 4; index++)
    connection.command([
      "bind-key",
      String(index),
      "run-shell",
      "-b",
      callback(view, file, "observe", ["--index", String(index)]),
    ]);
  connection.command([
    "bind-key",
    "?",
    "display-message",
    "m main; w/1-4 worker; c control; r release; h history; b mailbox; d detach; ! dismiss error; double Ctrl-g forwards native Ctrl-g",
  ]);
  connection.command([
    "set-hook",
    "-g",
    "client-detached",
    `run-shell -b ${quote(callback(view, file, "disconnect"))}`,
  ]);
  connection.command([
    "set-hook",
    "-g",
    "client-resized",
    `run-shell -b ${quote(`${callback(view, file, "resize")} --columns #{client_width} --rows #{client_height}`)}`,
  ]);
}

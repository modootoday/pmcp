import { spawn } from "node:child_process";
import { join } from "node:path";
import { command } from "../../../harness/adapters/process/command.js";
import { processIdentity } from "../../../harness/adapters/process/identity.js";
import type { View } from "../../contracts.js";
import {
  startPresentation,
  assertPresentationBudget,
} from "../process/budget.js";

export class ViewConnection {
  readonly socket: string;
  constructor(
    readonly directory: string,
    readonly owner: string,
    readonly identity?: string,
  ) {
    this.socket = join(directory, "s");
  }

  raw(args: string[]): string {
    const env = { ...process.env };
    delete env.TMUX;
    const options = [
      "-S",
      this.socket,
      "-f",
      join(this.directory, "tmux.conf"),
      ...args,
    ];
    if (args[0] === "new-session" && !this.identity)
      return startPresentation(this.owner, options, env).trim();
    return command(
      "tmux",
      ["-S", this.socket, "-f", join(this.directory, "tmux.conf"), ...args],
      { env },
    ).trim();
  }

  serverIdentity(): string {
    return processIdentity(
      Number(this.raw(["display-message", "-p", "#{pid}"])),
    );
  }

  assertServer(): void {
    if (
      !this.identity ||
      this.serverIdentity() !== this.identity ||
      this.raw(["show-option", "-gv", "@pmcp-tui-owner"]) !== this.owner
    )
      throw new Error("foreign_view_server");
    assertPresentationBudget(this.owner, Number(this.identity.split(":")[0]));
  }

  command(args: string[]): string {
    this.assertServer();
    return this.raw(args);
  }

  own(pane: string): string {
    if (!/^%\d+$/.test(pane)) throw new Error("invalid_view_pane");
    this.command([
      "set-option",
      "-p",
      "-t",
      pane,
      "@pmcp-tui-owner",
      this.owner,
    ]);
    return pane;
  }

  assertOwned(pane: string): void {
    if (
      !/^%\d+$/.test(pane) ||
      this.command([
        "display-message",
        "-p",
        "-t",
        pane,
        "#{@pmcp-tui-owner}",
      ]) !== this.owner
    )
      throw new Error("foreign_view_pane");
  }

  cleanup(): void {
    this.command(["kill-server"]);
  }

  async attach(view: View): Promise<number> {
    this.assertServer();
    if (!process.stdin.isTTY || !process.stdout.isTTY)
      throw new Error("terminal_required");
    const env = { ...process.env };
    delete env.TMUX;
    const client = spawn(
      "tmux",
      ["-S", this.socket, "attach-session", "-E", "-t", view.session],
      { stdio: "inherit", env },
    );
    return new Promise((resolve, reject) => {
      client.once("error", reject);
      client.once("exit", (code) => resolve(code ?? 1));
    });
  }
}

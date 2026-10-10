import { quote } from "../../../harness/adapters/process/command.js";
import type { TerminalLayout } from "../../../harness/terminal/layout.js";
import type { View, PanelRole } from "../../contracts.js";
import { phaseLabel } from "../../application/feedback.js";
import { ViewConnection } from "./connection.js";
import { bindKeys } from "./bindings.js";

export class TmuxView {
  readonly connection: ViewConnection;
  constructor(
    readonly view: View,
    readonly stateFile: string,
  ) {
    this.connection = new ViewConnection(
      view.directory,
      view.owner,
      view.serverIdentity,
    );
  }

  shell(argv: string[]): string {
    return `exec ${argv.map(quote).join(" ")}`;
  }

  panel(role: PanelRole): string[] {
    return [this.view.node, this.view.worker, "panel", this.stateFile, role];
  }

  attachment(sessionId: string, leaseFile?: string): string[] {
    return [
      this.view.node,
      this.view.worker,
      "attach",
      this.stateFile,
      sessionId,
      ...(leaseFile ? [leaseFile] : []),
    ];
  }

  configure(): void {
    const connection = this.connection;
    connection.own(this.view.mainPane);
    this.input(this.view.mainPane, false);
    connection.command(["set-option", "-g", "status", "on"]);
    connection.command(["set-option", "-g", "status-left", "PMCP A | "]);
    connection.command(["set-option", "-g", "status-right-length", "120"]);
    connection.command([
      "set-option",
      "-w",
      "-t",
      this.view.window,
      "window-size",
      "manual",
    ]);
    connection.command([
      "set-option",
      "-w",
      "-t",
      this.view.window,
      "pane-border-status",
      "off",
    ]);
    bindKeys(connection, this.view, this.stateFile);
  }

  resize(view: View, plan: TerminalLayout) {
    this.connection.assertOwned(view.mainPane);
    for (const pane of [view.dockPane, view.coordinationPane]) {
      if (!pane) continue;
      this.connection.assertOwned(pane);
      this.connection.command(["kill-pane", "-t", pane]);
    }
    delete view.dockPane;
    delete view.coordinationPane;
    this.connection.command([
      "resize-window",
      "-t",
      view.window,
      "-x",
      String(plan.columns),
      "-y",
      String(plan.rows - 1),
    ]);
    if (plan.mode === "a") {
      if (view.managementWindow) {
        this.connection.command(["kill-window", "-t", view.managementWindow]);
        delete view.managementWindow;
      }
      const width = plan.panes.find((pane) => pane.role === "dock")!.columns;
      view.dockPane = this.connection.own(
        this.connection.command([
          "split-window",
          "-h",
          "-t",
          view.mainPane,
          "-l",
          String(width),
          "-P",
          "-F",
          "#{pane_id}",
          this.shell(this.panel("dock")),
        ]),
      );
      view.coordinationPane = this.connection.own(
        this.connection.command([
          "split-window",
          "-v",
          "-f",
          "-t",
          view.mainPane,
          "-l",
          "4",
          "-P",
          "-F",
          "#{pane_id}",
          this.shell(this.panel("coordination")),
        ]),
      );
    }
    if (plan.mode === "compact") {
      if (!view.managementWindow) {
        const result = this.connection
          .command([
            "new-window",
            "-d",
            "-t",
            view.session,
            "-n",
            "management",
            "-P",
            "-F",
            "#{window_id}|#{pane_id}",
            this.shell(this.panel("management")),
          ])
          .split("|");
        view.managementWindow = result[0];
        this.connection.own(result[1]!);
      }
    }
    this.connection.command(["select-pane", "-t", view.mainPane]);
    view.plan = plan;
    if (view.workerWindow) this.select(view, false);
  }

  replace(pane: string, argv: string[]) {
    this.connection.assertOwned(pane);
    this.connection.command([
      "respawn-pane",
      "-k",
      "-t",
      pane,
      this.shell(argv),
    ]);
  }

  worker(view: View, argv: string[], role: View["observerRole"] = "native") {
    if (view.workerWindow) {
      this.connection.assertOwned(view.workerPane!);
      this.connection.command(["kill-window", "-t", view.workerWindow]);
    }
    const result = this.connection
      .command([
        "new-window",
        "-t",
        view.session,
        "-n",
        "worker-observation",
        "-P",
        "-F",
        "#{window_id}|#{pane_id}",
        this.shell(argv),
      ])
      .split("|");
    view.workerWindow = result[0];
    view.workerPane = this.connection.own(result[1]!);
    this.connection.command(["select-window", "-t", view.workerWindow!]);
    view.observerRole = role;
    this.input(view.workerPane!, false);
  }

  select(view: View, main = false) {
    this.connection.command([
      "select-window",
      "-t",
      main ? view.window : view.workerWindow!,
    ]);
  }

  closeObserver(view: View) {
    if (!view.workerWindow) return;
    this.connection.assertOwned(view.workerPane!);
    this.connection.command(["kill-window", "-t", view.workerWindow]);
    delete view.workerWindow;
    delete view.workerPane;
    delete view.observerRole;
  }

  status(view: View): void {
    const failure = view.failure
      ? ` | ERROR ${view.failure.code} (! dismiss)`
      : "";
    this.connection.command([
      "set-option",
      "-g",
      "status-right",
      `${view.target === view.mainId ? "main" : "worker"} | ${phaseLabel(view.phase)}${failure} | Ctrl-g ?`,
    ]);
  }

  input(pane: string, enabled: boolean): void {
    this.connection.assertOwned(pane);
    this.connection.command(["select-pane", enabled ? "-e" : "-d", "-t", pane]);
  }

  tty(pane: string): string {
    this.connection.assertOwned(pane);
    return this.connection.command([
      "display-message",
      "-p",
      "-t",
      pane,
      "#{pane_tty}",
    ]);
  }

  detach(view: View): void {
    this.connection.command(["detach-client", "-s", view.session]);
  }

  clients(): string {
    return this.connection.command(["list-clients", "-F", "#{client_pid}"]);
  }

  copy(pane: string): void {
    this.connection.assertOwned(pane);
    this.connection.command(["copy-mode", "-t", pane]);
  }

  capture(pane: string): string {
    this.connection.assertOwned(pane);
    return this.connection.command(["capture-pane", "-p", "-J", "-t", pane]);
  }
}

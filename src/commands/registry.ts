// Keep command metadata separate so help, version and completion avoid loading implementations.

import type { CommandEntry } from "../cli/command.js";
import { completionSpec } from "./specs/completion.js";
import {
  indexSpec,
  listSpec,
  modelsSpec,
  validateSpec,
} from "./specs/catalog.js";
import { mailboxSpec } from "./specs/mailbox.js";
import { marketplaceSpec } from "./specs/marketplace.js";
import { doctorSpec, projectSpec } from "./specs/project.js";
import {
  availableSpec,
  installSpec,
  previewSpec,
  syncSpec,
} from "./specs/remote.js";
import { serveSpec } from "./specs/serve.js";
import { loginSpec, logoutSpec, whoamiSpec } from "./specs/session.js";
import { harnessSpec, tuiSpec } from "./specs/terminal.js";
import { gitSpec } from "./specs/git.js";
import { logsSpec } from "./specs/logs.js";
import { mcpSpec } from "./specs/mcp.js";
import { sessionsSpec } from "./specs/sessions.js";
import { statusSpec, initSpec, hooksSpec } from "./specs/inspection.js";

export const COMMANDS: readonly CommandEntry[] = [
  {
    ...statusSpec,
    load: async () => (await import("./status.js")).statusCommand,
  },
  { ...initSpec, load: async () => (await import("./init.js")).initCommand },
  { ...hooksSpec, load: async () => (await import("./hooks.js")).hooksCommand },
  { ...serveSpec, load: async () => (await import("./serve.js")).serveCommand },
  { ...listSpec, load: async () => (await import("./list.js")).listCommand },
  {
    ...indexSpec,
    load: async () => (await import("./reindex.js")).indexCommand,
  },
  {
    ...modelsSpec,
    load: async () => (await import("./models.js")).modelsCommand,
  },
  {
    ...loginSpec,
    load: async () => (await import("./session.js")).loginCommand,
  },
  {
    ...logoutSpec,
    load: async () => (await import("./session.js")).logoutCommand,
  },
  {
    ...whoamiSpec,
    load: async () => (await import("./session.js")).whoamiCommand,
  },
  {
    ...availableSpec,
    load: async () => (await import("./available.js")).availableCommand,
  },
  {
    ...previewSpec,
    load: async () => (await import("./preview.js")).previewCommand,
  },
  {
    ...installSpec,
    load: async () => (await import("./install.js")).installCommand,
  },
  { ...syncSpec, load: async () => (await import("./install.js")).syncCommand },
  {
    ...projectSpec,
    load: async () => (await import("./project.js")).projectCommand,
  },
  {
    ...doctorSpec,
    load: async () => (await import("./doctor.js")).doctorCommand,
  },
  {
    ...sessionsSpec,
    load: async () => (await import("../sessions/cli.js")).sessionsCommand,
  },
  { ...logsSpec, load: async () => (await import("./logs.js")).logsCommand },
  { ...gitSpec, load: async () => (await import("../git/cli.js")).gitCommand },
  { ...mcpSpec, load: async () => (await import("./mcp.js")).mcpCommand },
  {
    ...validateSpec,
    load: async () => (await import("./validate.js")).validateCommand,
  },
  {
    ...mailboxSpec,
    load: async () => (await import("./mailbox.js")).mailboxCommand,
  },
  {
    ...harnessSpec,
    load: async () => (await import("./harness.js")).harnessCommand,
  },
  { ...tuiSpec, load: async () => (await import("./tui.js")).tuiCommand },
  {
    ...marketplaceSpec,
    load: async () => (await import("./marketplace.js")).marketplaceCommand,
  },
  {
    ...completionSpec,
    load: async () => (await import("./completion.js")).completionCommand,
  },
];

// Do not register unavailable verbs because a help entry would imply working functionality.
export const PLANNED: readonly string[] = [];

export function commandNamed(
  name: string | undefined,
): CommandEntry | undefined {
  return COMMANDS.find((command) => command.name === name);
}

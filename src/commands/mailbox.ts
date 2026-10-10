import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ArgumentError,
  one,
  type Command,
  type CommandContext,
} from "../cli/command.js";
import {
  initializeMailboxConfig,
  mailboxConfigFrom,
  readBinding,
  readCredential,
  writePrivateJson,
} from "../mailbox/config.js";
import { MailboxService } from "../mailbox/service.js";
import { operationSchema } from "../mailbox/schemas.js";
import { MailboxStore, restoreBackup } from "../mailbox/store.js";
import { failure, MailboxError, type Binding } from "../mailbox/types.js";
import { configFrom } from "./roots.js";

const allowed: Readonly<Record<string, readonly string[]>> = {
  init: ["config", "state-dir"],
  actor: ["config", "actor", "actor-file", "parent-binding"],
  rotate: ["config", "actor", "actor-file", "operator"],
  send: ["config", "actor-file", "binding-file", "input"],
  inbox: ["config", "actor-file", "binding-file", "input"],
  read: ["config", "actor-file", "binding-file", "input"],
  ack: ["config", "actor-file", "binding-file", "input"],
  sessions: ["config", "actor-file", "binding-file"],
  export: ["config", "operator", "output", "scope-actor"],
  backup: ["config", "operator", "output"],
  restore: ["config", "operator", "input", "output"],
};

function required(context: CommandContext, name: string): string {
  const value = one(context.args, name);
  if (!value) throw new ArgumentError(`Provide --${name}`);
  return value;
}

export const mailboxCommand: Command = {
  name: "mailbox",
  describe: "Manage opt-in local peer mail and launcher credentials",
  usage: "pmcp mailbox operation [--config <file>] [options]",
  options: [
    { name: "config", describe: "Project pmcp.toml", placeholder: "<file>" },
    {
      name: "state-dir",
      describe: "Private mailbox state directory",
      placeholder: "<dir>",
    },
    { name: "actor", describe: "Registered actor ID", placeholder: "<id>" },
    {
      name: "actor-file",
      describe: "Private actor credential file",
      placeholder: "<file>",
    },
    {
      name: "binding-file",
      describe: "Private existing attachment file",
      placeholder: "<file>",
    },
    {
      name: "parent-binding",
      describe: "Live parent attachment for bounded child delegation",
      placeholder: "<file>",
    },
    {
      name: "input",
      describe: "Operation input JSON or backup source",
      placeholder: "<file>",
    },
    {
      name: "output",
      describe: "New export or backup destination",
      placeholder: "<file>",
    },
    {
      name: "scope-actor",
      describe: "Limit export to one actor's correspondence",
      placeholder: "<id>",
    },
    {
      name: "operator",
      describe: "Explicit local administrator intent",
      boolean: true,
    },
  ],
  async run(context) {
    const [verb, ...extra] = context.args.positional;
    const supported = verb ? allowed[verb] : undefined;
    if (!supported || extra.length > 0)
      throw new ArgumentError("Provide one supported mailbox operation");
    for (const key of [...context.args.options.keys(), ...context.args.flags]) {
      if (!supported.includes(key))
        throw new ArgumentError(`--${key} is not supported by mailbox ${verb}`);
    }
    if (verb === "init") {
      const config = initializeMailboxConfig(
        resolve(context.cwd, one(context.args, "config") ?? "pmcp.toml"),
        one(context.args, "state-dir"),
      );
      const store = await MailboxStore.open(config);
      await store.close();
      context.ui.data(
        `${JSON.stringify({ ok: true, data: { projectId: config.projectId } })}\n`,
      );
      return 0;
    }
    const project = configFrom(context);
    const config = project
      ? mailboxConfigFrom(project, context.env)
      : undefined;
    if (!config?.enabled)
      throw new MailboxError(
        "mailbox_disabled",
        "Enable [mailbox] in pmcp.toml first",
      );
    if (["export", "backup", "restore", "rotate"].includes(verb!)) {
      if (!context.args.flags.has("operator"))
        throw new ArgumentError("Provide --operator for local administration");
    }
    if (verb === "restore") {
      await restoreBackup(required(context, "input"), {
        ...config,
        databasePath: resolve(context.cwd, required(context, "output")),
      });
      context.ui.data(
        `${JSON.stringify({ ok: true, data: { restored: true } })}\n`,
      );
      return 0;
    }
    const store = await MailboxStore.open(config);
    let binding: Binding | undefined;
    let ownsBinding = false;
    try {
      if (verb === "actor") {
        const parentFile = one(context.args, "parent-binding");
        const parent = parentFile ? readBinding(parentFile) : undefined;
        const destination = required(context, "actor-file");
        const credential = await store.registerActor(
          required(context, "actor"),
          parent?.actorId,
          (value) => writePrivateJson(destination, value),
          60_000,
          parent,
        );
        context.ui.data(
          `${JSON.stringify({ ok: true, data: { actorId: credential.actorId } })}\n`,
        );
        return 0;
      }
      if (verb === "rotate") {
        const destination = required(context, "actor-file");
        const credential = await store.rotateActor(
          required(context, "actor"),
          (value) => writePrivateJson(destination, value),
        );
        context.ui.data(
          `${JSON.stringify({ ok: true, data: { actorId: credential.actorId } })}\n`,
        );
        return 0;
      }
      if (verb === "backup" || verb === "export") {
        const destination = required(context, "output");
        if (verb === "backup") {
          await store.backup(destination);
        } else {
          const records = await store.exportRecords(
            one(context.args, "scope-actor"),
          );
          writeFileSync(
            destination,
            `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
            { flag: "wx", mode: 0o600 },
          );
        }
        context.ui.data(
          `${JSON.stringify({ ok: true, data: { completed: verb } })}\n`,
        );
        return 0;
      }
      const operation = operationSchema.parse(verb);
      const actorFile = one(context.args, "actor-file");
      const bindingFile = one(context.args, "binding-file");
      if (Boolean(actorFile) === Boolean(bindingFile))
        throw new ArgumentError("Choose one --actor-file or --binding-file");
      if (bindingFile) {
        binding = readBinding(bindingFile);
      } else {
        binding = await store.attach(readCredential(actorFile!), "operator");
        ownsBinding = true;
      }
      const inputFile = one(context.args, "input");
      const input = inputFile
        ? JSON.parse(readFileSync(inputFile, "utf8"))
        : {};
      const result = await new MailboxService(store, binding).call(
        operation,
        input,
      );
      context.ui.data(`${JSON.stringify(result)}\n`);
      return result.ok ? 0 : 1;
    } catch (error) {
      if (error instanceof ArgumentError) throw error;
      context.ui.data(`${JSON.stringify(failure(error))}\n`);
      return 1;
    } finally {
      try {
        if (ownsBinding && binding) await store.detach(binding);
      } finally {
        await store.close();
      }
    }
  },
};

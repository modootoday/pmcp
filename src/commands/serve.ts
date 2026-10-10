/**
 * The invocation a host uses. Reachable by name so it appears in help, but it
 * is also what running pmcp with no command does, because the MCP host contract
 * is a bare spawn.
 */

import { ArgumentError, one, type Command } from "../cli/command.js";
import { invocation } from "../cli/invocation.js";
import { serve, serveWithMailbox } from "../stdio.js";
import { mailboxConfigFrom } from "../mailbox/config.js";
import { prepareSearch } from "../search.js";
import { indexPath } from "./reindex.js";
import { EMBEDDING_OPTIONS, embeddingFrom } from "./embedding.js";

import {
  CATALOG_OPTIONS,
  catalogOptionsFrom,
  configFrom,
  rootsFrom,
} from "./roots.js";

export const serveCommand: Command = {
  name: "serve",
  describe: "Run the MCP server on stdio (also the default for piped launches)",
  usage:
    "pmcp serve [--root <dir>] [--scope <prefix>] [--marketplace <dir>] [--package <dir>] [--workspace <dir>] [--config <file> | --no-config] [--prompts]",
  options: [
    ...CATALOG_OPTIONS,
    ...EMBEDDING_OPTIONS,
    {
      name: "lexical",
      describe: "Skip semantic index and model loading",
      boolean: true,
    },
    {
      name: "mailbox-actor-file",
      describe: "Private launcher actor credential for opt-in mailbox",
      placeholder: "<file>",
    },
    {
      name: "mailbox-binding-file",
      describe: "Private attachment file written by the launcher",
      placeholder: "<file>",
    },
    {
      name: "mailbox-runtime",
      describe: "Launcher-assigned canonical runtime",
      placeholder: "<runtime>",
    },
    {
      name: "mailbox-replace-session",
      describe: "Exact old attachment ID to replace",
      placeholder: "<id>",
    },
    {
      name: "mailbox-native-session",
      describe: "Launcher-owned native session ID",
      placeholder: "<id>",
    },
    {
      name: "prompts",
      describe:
        "Also offer one prompt per skill, for hosts that turn prompts into commands.",
      boolean: true,
    },
  ],

  async run(context) {
    const selection = embeddingFrom(context);
    const project = configFrom(context);
    const mailbox = project
      ? mailboxConfigFrom(project, context.env)
      : undefined;
    const actorFile =
      one(context.args, "mailbox-actor-file") ??
      context.env.PMCP_MAILBOX_ACTOR_FILE;
    const runtime =
      one(context.args, "mailbox-runtime") ?? context.env.PMCP_MAILBOX_RUNTIME;
    const catalog = catalogOptionsFrom(context);
    const search =
      context.args.flags.has("lexical") || selection.enabled === false
        ? undefined
        : await prepareSearch(catalog, {
            indexPath: indexPath(rootsFrom(context)[0] ?? "."),
            ...selection,
            localOnly: true,
          });
    if (search && search.reason !== "index_missing") {
      const hint = search.reason
        ? ` reason=${search.reason}; run ${invocation(context.env)} index with the selected model`
        : "";
      process.stderr.write(`pmcp: search ranking=${search.ranking}${hint}\n`);
    }
    const serving = {
      prompts: context.args.flags.has("prompts"),
      ...search?.options,
    };
    if (actorFile) {
      if (!mailbox?.enabled)
        throw new ArgumentError("Enable [mailbox] before attaching an actor");
      if (!runtime)
        throw new ArgumentError(
          "Provide --mailbox-runtime or PMCP_MAILBOX_RUNTIME",
        );
      await serveWithMailbox(
        catalogOptionsFrom(context),
        {
          config: mailbox,
          actorFile,
          runtime,
          bindingFile:
            one(context.args, "mailbox-binding-file") ??
            context.env.PMCP_MAILBOX_BINDING_FILE,
          replaceSessionId: one(context.args, "mailbox-replace-session"),
          nativeSessionId: one(context.args, "mailbox-native-session"),
        },
        serving,
      );
      return 0;
    }
    if (
      [...context.args.options.keys()].some((name) =>
        name.startsWith("mailbox-"),
      ) ||
      runtime ||
      context.env.PMCP_MAILBOX_BINDING_FILE
    ) {
      throw new ArgumentError("Provide a launcher mailbox actor file");
    }
    // Nothing is written to stdout here. From this point stdout is the
    // protocol, and a diagnostic on it corrupts the stream.
    serve(catalogOptionsFrom(context), serving);
    return 0;
  },
};

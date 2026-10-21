// Preserve bare serving because native MCP hosts launch the process without a verb.

import { ArgumentError, one, type Command } from "../cli/command.js";
import { invocation } from "../cli/invocation.js";
import { serve, serveWithMailbox } from "../stdio.js";
import { mailboxConfigFrom } from "../mailbox/config.js";
import { prepareSearch } from "../search.js";
import { indexPath } from "./reindex.js";
import { embeddingFrom } from "./embedding.js";

import { catalogOptionsFrom, configFrom, rootsFrom } from "./roots.js";
import { serveSpec } from "./specs/serve.js";

export const serveCommand: Command = {
  ...serveSpec,

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
    // Keep diagnostics off stdout because it carries the MCP protocol.
    serve(catalogOptionsFrom(context), serving);
    return 0;
  },
};

/**
 * Encodes every description once, so ranking can be semantic.
 *
 * Named a verb and filed apart from the registry: the command is `index`, the
 * module beside this one that dispatches it is `index.ts`.
 */

import { one, type Command } from "../cli/command.js";
import { loadEmbedder, openEntryVectors } from "../embed.js";

import { CATALOG_OPTIONS, catalogFrom, rootsFrom } from "./roots.js";

/** Beside the tree it describes, so two projects never share one index. */
export function indexPath(root: string): string {
  return `${root}/.cache/pmcp/vectors.sqlite`;
}

export const indexCommand: Command = {
  name: "index",
  describe: "Encode the catalog so ranking can be semantic",
  usage: "pmcp index [--root <dir>] [--model <id>]",
  options: [
    ...CATALOG_OPTIONS,
    {
      name: "model",
      describe: "Encoder to use. Rows from another model are never scored.",
      placeholder: "<id>",
    },
    {
      name: "json",
      describe: "Emit JSON rather than a summary.",
      boolean: true,
    },
    {
      name: "dry-run",
      describe: "Report what would be encoded and write nothing.",
      boolean: true,
    },
  ],

  async run(context) {
    const entries = catalogFrom(context);
    if (entries.length === 0) {
      context.ui.error("no skills to index", rootsFrom(context).join(" "));
      return 1;
    }
    const dryRun = context.args.flags.has("dry-run");

    const model = one(context.args, "model");
    const embedder = await loadEmbedder(model);
    if (embedder === null) {
      context.ui.error(
        "semantic ranking needs an encoder that is not installed",
      );
      context.ui.info("npm install --save-dev @huggingface/transformers");
      context.ui.info("ranking stays lexical until then, which is the default");
      return 3;
    }

    const store = await openEntryVectors(
      indexPath(rootsFrom(context)[0] ?? "."),
    );
    if (store === null) {
      context.ui.error(
        "no sqlite in this runtime, so vectors cannot be stored",
      );
      return 1;
    }

    try {
      const descriptions = new Map(entries.map((e) => [e.name, e.description]));
      const stale = new Set(store.stale(embedder.modelId, descriptions));
      // Only what changed. Re-encoding an unchanged description costs the same
      // as the first time and produces the same vector.
      const todo = entries.filter((entry) => stale.has(entry.name));
      context.ui.info(
        `${todo.length} of ${entries.length} to encode`,
        embedder.modelId,
      );

      if (dryRun) {
        for (const entry of todo)
          context.ui.line(`  would encode ${entry.name}`);
        context.ui.info("dry run, nothing written");
        return 0;
      }

      for (const entry of todo) {
        const vector = await embedder.embed(entry.description);
        store.write(embedder.modelId, entry.name, entry.description, vector);
      }

      const indexed = store.read(embedder.modelId).size;
      if (context.args.flags.has("json")) {
        context.ui.data(
          `${JSON.stringify(
            {
              model: embedder.modelId,
              encoded: todo.length,
              indexed,
              catalog: entries.length,
            },
            null,
            2,
          )}\n`,
        );
      }

      // Partial coverage is reported rather than called success: find needs a
      // vector for every entry, so a partial index ranks lexically anyway.
      if (indexed < entries.length) {
        context.ui.warn(
          `indexed ${indexed} of ${entries.length}`,
          "ranking stays lexical",
        );
        return 1;
      }
      context.ui.success(`indexed ${indexed} skills`, embedder.modelId);
      return 0;
    } finally {
      store.close();
    }
  },
};

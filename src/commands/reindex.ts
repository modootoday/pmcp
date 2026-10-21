// Keep indexing separate from the registry so metadata queries do not load encoder dependencies.

import { EXIT, type Command } from "../cli/command.js";
import { loadEmbedder, openEntryVectors } from "../embed.js";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { resolveEncoder } from "../encoder.js";
import { embeddingFrom } from "./embedding.js";

import { catalogFrom, rootsFrom } from "./roots.js";
import { indexSpec } from "./specs/catalog.js";

// Keep indexes beside their project so unrelated projects cannot share stale vectors.
export function indexPath(root: string): string {
  return `${root}/.cache/pmcp/vectors.sqlite`;
}

export const indexCommand: Command = {
  ...indexSpec,

  async run(context) {
    const entries = catalogFrom(context);
    if (entries.length === 0) {
      context.ui.error("no skills to index", rootsFrom(context).join(" "));
      return 1;
    }
    const dryRun = context.args.flags.has("dry-run");
    const selection = embeddingFrom(context);
    const selected = resolveEncoder(selection.modelId, selection);
    const path = indexPath(rootsFrom(context)[0] ?? ".");
    const descriptions = new Map(
      entries.map((entry) => [entry.name, entry.description]),
    );
    const force = context.args.flags.has("force");
    if (dryRun) {
      const existing = existsSync(path)
        ? await openEntryVectors(path, { readOnly: true })
        : null;
      try {
        const pending =
          !force && existing
            ? existing.stale(selected.indexKey, descriptions)
            : [...descriptions.keys()];
        for (const name of pending) context.ui.line(`  would encode ${name}`);
        context.ui.info("dry run, nothing written");
        return 0;
      } finally {
        existing?.close();
      }
    }
    const embedder = await loadEmbedder(selected.modelId, {
      ...selection,
      localOnly: context.args.flags.has("local-only"),
    });
    if (embedder === null) {
      context.ui.error(
        "semantic ranking needs an encoder that is not installed",
      );
      context.ui.info("npm install --save-dev @huggingface/transformers");
      context.ui.info("ranking stays lexical until then, which is the default");
      return EXIT.missingOptional;
    }

    mkdirSync(dirname(path), { recursive: true });
    const store = await openEntryVectors(path);
    if (store === null) {
      context.ui.error(
        "no sqlite in this runtime, so vectors cannot be stored",
      );
      return 1;
    }

    try {
      const key = embedder.indexKey ?? selected.indexKey;
      const stale = new Set(
        force ? [...descriptions.keys()] : store.stale(key, descriptions),
      );
      // Reuse unchanged descriptions to avoid repeating identical embedding work.
      const todo = entries.filter((entry) => stale.has(entry.name));
      context.ui.info(
        `${todo.length} of ${entries.length} to encode`,
        embedder.modelId,
      );

      for (const entry of todo) {
        const vector = embedder.embedPassage
          ? await embedder.embedPassage(entry.description)
          : await embedder.embed(entry.description);
        store.write(key, entry.name, entry.description, vector);
      }

      const indexed = store.read(key).size;
      if (context.args.flags.has("json")) {
        context.ui.data(
          `${JSON.stringify(
            {
              model: embedder.modelId,
              indexKey: key,
              dtype: selected.dtype,
              revision: selected.revision,
              dimensions: embedder.dims || selected.dimensions,
              encoded: todo.length,
              indexed,
              catalog: entries.length,
            },
            null,
            2,
          )}\n`,
        );
      }

      // Report incomplete coverage because a partial index cannot provide comparable semantic rankings.
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

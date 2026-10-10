import { type Command } from "../cli/command.js";
import { embeddingModels } from "../encoder.js";

export const modelsCommand: Command = {
  name: "models",
  describe: "List embedding presets without loading or downloading models",
  usage: "pmcp models [--json]",
  options: [
    { name: "json", describe: "Emit preset metadata as JSON", boolean: true },
  ],
  run(context) {
    const models = embeddingModels();
    if (context.args.flags.has("json")) {
      context.ui.data(`${JSON.stringify(models, null, 2)}\n`);
      return 0;
    }
    context.ui.table(
      models.map((model) => [
        model.name,
        `${model.modelId} (${model.dtype}; dimensions: ${model.dimensions.join(", ")})`,
      ]),
    );
    return 0;
  },
};

import { ArgumentError, type Command } from "../cli/command.js";
import { embeddingModels } from "../encoder.js";
import { modelsSpec } from "./specs/catalog.js";

export const modelsCommand: Command = {
  ...modelsSpec,
  run(context) {
    if (context.args.positional.length > 0)
      throw new ArgumentError(`unexpected ${context.args.positional[0]}`);
    const models = embeddingModels();
    if (context.args.flags.has("json")) {
      context.ui.data(`${JSON.stringify(models, null, 2)}\n`);
      return 0;
    }
    context.ui.results.table(
      models.map((model) => [
        model.name,
        `${model.modelId} (${model.dtype}; dimensions: ${model.dimensions.join(", ")})`,
      ]),
    );
    return 0;
  },
};

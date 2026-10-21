import type { OptionSpec } from "../../cli/command.js";

export const EMBEDDING_OPTIONS: readonly OptionSpec[] = [
  {
    name: "model",
    describe: "Embedding preset or model ID; list presets with pmcp models",
    placeholder: "<name>",
  },
  {
    name: "dtype",
    describe: "Weight precision; uses the selected model default when omitted",
    placeholder: "<q4|q8|fp32>",
  },
  {
    name: "dimensions",
    describe:
      "Supported output width; uses the model's full output when omitted",
    placeholder: "<number>",
  },
  {
    name: "model-revision",
    describe: "Model revision used for loading and index identity",
    placeholder: "<revision>",
  },
  {
    name: "model-path",
    describe: "Local model artifact directory",
    placeholder: "<dir>",
  },
  {
    name: "model-cache",
    describe: "Model cache directory",
    placeholder: "<dir>",
  },
  {
    name: "query-prefix",
    describe: "Custom model's query instruction prefix",
    placeholder: "<text>",
  },
  {
    name: "passage-prefix",
    describe: "Custom model's document instruction prefix",
    placeholder: "<text>",
  },
  {
    name: "pooling",
    describe: "Custom model's pooling method",
    placeholder: "<mean|cls>",
  },
];

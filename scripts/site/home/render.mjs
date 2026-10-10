import { readFileSync } from "node:fs";
import { features, runtimes } from "./model.js";
import { escape } from "../layout/html.mjs";
import { exampleResults } from "../examples/render.mjs";

export function renderHome(examples) {
  const feature = features[0];
  const buttons = features
    .map(
      (entry, index) =>
        `<button type="button" data-feature-tab="${entry.id}" aria-pressed="${index === 0}"><span>${entry.label}</span><small>${entry.scope}</small></button>`,
    )
    .join("\n");
  const pickers = runtimes
    .map(
      (runtime) =>
        `<button type="button" data-runtime="${runtime.id}" aria-pressed="${runtime.id === "codex"}">${runtime.name}</button>`,
    )
    .join("\n");
  const hero = readFileSync(
    new URL("hero/content.html", import.meta.url),
    "utf8",
  ).replace("{{runtimePickers}}", pickers);
  const values = {
    hero,
    featureButtons: buttons,
    featureScope: escape(feature.scope),
    featureTitle: escape(feature.title),
    featureDescription: escape(feature.description),
    featureCode: escape(feature.code),
    exampleResults: exampleResults(examples),
  };
  return readFileSync(new URL("content.html", import.meta.url), "utf8").replace(
    /\{\{(\w+)\}\}/gu,
    (match, name) => {
      if (!(name in values))
        throw new Error(`Unknown home template field ${name}`);
      return values[name];
    },
  );
}

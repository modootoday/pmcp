import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function argumentsFor(argv, accepted) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (!accepted.includes(key) || key in options)
      throw new Error(`Unsupported or duplicate option: ${key}`);
    if (key === "--check") {
      options[key] = true;
      continue;
    }
    const value = argv[++index];
    if (!value || value.startsWith("--"))
      throw new Error(`${key} requires a value`);
    options[key] = resolve(value);
  }
  return options;
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { commit } from "./page.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const check = process.argv.includes("--check");
const css = ["layout", "components"]
  .map((name) =>
    readFileSync(new URL(`site/styles/${name}.css`, import.meta.url), "utf8"),
  )
  .join("\n");
const changed = commit(
  [
    {
      file: fileURLToPath(new URL("../docs/assets/style.css", import.meta.url)),
      html: css,
    },
  ],
  { root, check },
);
console.log(JSON.stringify({ changed, mode: check ? "check" : "write" }));
if (check && changed > 0) process.exitCode = 1;

import { fileURLToPath } from "node:url";
import { argumentsFor, readJson } from "./library-skills/cli.mjs";
import {
  preparePublication,
  writePublication,
} from "./library-skills/publication.mjs";

const options = argumentsFor(process.argv.slice(2), [
  "--root",
  "--metadata",
  "--evidence",
  "--check",
]);
if (!options["--metadata"]) throw new Error("--metadata is required");
const root =
  options["--root"] ?? fileURLToPath(new URL("../", import.meta.url));
const evidence = options["--evidence"]
  ? readJson(options["--evidence"])
  : undefined;
const prepared = preparePublication(
  root,
  readJson(options["--metadata"]),
  evidence,
);
if (options["--check"]) {
  console.log(
    JSON.stringify({
      selected: prepared.selected,
      revision: prepared.catalog.revision,
      writes: prepared.writes.length,
      check: true,
    }),
  );
} else {
  console.log(JSON.stringify(writePublication(prepared)));
}

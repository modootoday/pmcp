import { fileURLToPath } from "node:url";
import { checkLibrarySkills } from "./library-skills/check.mjs";
import { argumentsFor } from "./library-skills/cli.mjs";

const options = argumentsFor(process.argv.slice(2), ["--root"]);
const root =
  options["--root"] ?? fileURLToPath(new URL("../", import.meta.url));
console.log(JSON.stringify(checkLibrarySkills(root)));

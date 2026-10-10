import { fileURLToPath } from "node:url";
import { argumentsFor } from "./library-skills/cli.mjs";
import { applyMarketplaceProjections } from "./marketplace/projections.mjs";

const options = argumentsFor(process.argv.slice(2), ["--root", "--check"]);
const root =
  options["--root"] ?? fileURLToPath(new URL("../", import.meta.url));
console.log(
  JSON.stringify(
    await applyMarketplaceProjections(root, options["--check"] === true),
  ),
);

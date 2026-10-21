import { registerHooks } from "node:module";
import { writeFileSync } from "node:fs";

const loaded = [];
registerHooks({
  load(url, context, next) {
    loaded.push(url);
    return next(url, context);
  },
});
process.on("exit", () => {
  writeFileSync(process.env.PMCP_MODULE_RECORD, JSON.stringify(loaded));
});

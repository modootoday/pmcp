import { main } from "./hook-adapter/run.js";
export { guardPath } from "./hook-adapter/path.js";
export { evaluateShellHook } from "./hook-adapter/evaluate.js";
export { nativeHookDecision } from "./hook-adapter/render.js";
if (process.argv[2] === "--pmcp-shell-hook") {
  await main();
}

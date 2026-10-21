import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

import { checkoutOf } from "./checkout.js";

// A desk's pmcp.toml sits in its own worktree, so relative paths resolve from the same place
// in the main checkout; otherwise every linked desk would coordinate through its own state.
function mainCheckoutBase(dir: string): string {
  const checkout = checkoutOf(dir);
  if (!checkout || basename(checkout.commonDir) !== ".git") return dir;
  const inside = relative(checkout.root, resolve(dir));
  return join(dirname(checkout.commonDir), inside);
}

// Expand home paths consistently so configuration and shell inputs resolve to the same state.
export function expandPath(base: string, path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  if (path.startsWith("$HOME/")) return join(homedir(), path.slice(6));
  return isAbsolute(path) ? path : resolve(mainCheckoutBase(base), path);
}

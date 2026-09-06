/**
 * The invocation a host uses. Reachable by name so it appears in help, but it
 * is also what running pmcp with no command does, because the MCP host contract
 * is a bare spawn.
 */

import type { Command } from "../cli/command.js";
import { serve } from "../stdio.js";

import { CATALOG_OPTIONS, rootsFrom } from "./roots.js";
import { many } from "../cli/command.js";

export const serveCommand: Command = {
  name: "serve",
  describe: "Run the MCP server on stdio (the default with no command)",
  usage: "pmcp serve [--root <dir>] [--scope <prefix>]",
  options: [...CATALOG_OPTIONS],

  run(context) {
    // Nothing is written to stdout here. From this point stdout is the
    // protocol, and a diagnostic on it corrupts the stream.
    serve(rootsFrom(context), many(context.args, "scope"));
    return 0;
  },
};

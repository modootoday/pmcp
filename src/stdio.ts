#!/usr/bin/env node
/**
 * The stdio entry a host launches.
 *
 * Wired as `node <path in node_modules>`, never `npx`: the server's position in
 * the dependency tree is its data source, and from an npx cache it is not a
 * sibling of the consumer's packages and would find no skills at all.
 */

import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { createSkillServer } from "./mcp.js";

/** `node_modules` roots to walk, from argv or from the working directory. */
export function resolveRoots(argv: readonly string[], cwd: string): string[] {
  const given = argv.filter((arg) => !arg.startsWith("-"));
  return given.length > 0 ? given : [`${cwd}/node_modules`];
}

export function serve(
  roots: readonly string[],
  scopes: readonly string[] = [],
): void {
  const options = scopes.length > 0 ? { roots, scopes } : { roots };
  serveStdio(() => createSkillServer(options), {
    // stdout is the protocol. A diagnostic written there corrupts the stream,
    // so out-of-band errors go to stderr and nowhere else.
    onerror: (error) => process.stderr.write(`pmcp: ${error.message}\n`),
  });
}

export function main(argv: readonly string[] = process.argv.slice(2)): void {
  const scopeArg = argv.find((arg) => arg.startsWith("--scope="));
  serve(
    resolveRoots(argv, process.cwd()),
    scopeArg ? scopeArg.slice("--scope=".length).split(",") : [],
  );
}

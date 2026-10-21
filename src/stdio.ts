#!/usr/bin/env node
// Launch the installed entry directly because an npx cache would discover the wrong dependency tree.

import { serveStdio } from "@modelcontextprotocol/server/stdio";

import type { CatalogOptions } from "./catalog.js";
import type { SkillServerOptions } from "./server.js";
import { createSkillServer } from "./mcp.js";
import type { MailboxService } from "./mailbox/service.js";
import {
  attachMailbox,
  type MailboxAttachmentOptions,
} from "./mailbox/attachment.js";

export function resolveRoots(argv: readonly string[], cwd: string): string[] {
  const given = argv.filter((arg) => !arg.startsWith("-"));
  return given.length > 0 ? given : [`${cwd}/node_modules`];
}

export interface ServeOptions extends Pick<
  SkillServerOptions,
  "embedder" | "vectors" | "loadCatalog"
> {
  readonly mailbox?: MailboxService;

  readonly prompts?: boolean;
}

export function serve(
  catalog: CatalogOptions,
  serving: ServeOptions = {},
): ReturnType<typeof serveStdio> {
  const options = {
    ...catalog,
    ...serving,
    onReject: ({ path, reason }: { path: string; reason: string }) =>
      process.stderr.write(`pmcp: skipped ${path}: ${reason}\n`),
    onWarning: ({ path, reason }: { path: string; reason: string }) =>
      process.stderr.write(`pmcp: warning ${path}: ${reason}\n`),
  };
  return serveStdio(() => createSkillServer(options), {
    // Keep diagnostics on stderr because stdout carries the MCP protocol.
    onerror: (error) => process.stderr.write(`pmcp: ${error.message}\n`),
  });
}

export async function serveWithMailbox(
  catalog: CatalogOptions,
  mailbox: MailboxAttachmentOptions,
  serving: ServeOptions = {},
): Promise<() => Promise<void>> {
  let stop: (() => Promise<void>) | undefined;
  const attachment = await attachMailbox({
    ...mailbox,
    onExpired: () => {
      process.stderr.write("pmcp: mailbox attachment expired or superseded\n");
      void stop?.().catch(() => {
        process.exitCode = 1;
      });
    },
  });
  let handle: ReturnType<typeof serve>;
  try {
    handle = serve(catalog, { ...serving, mailbox: attachment.service });
  } catch (error) {
    await attachment.close();
    throw error;
  }
  let shutdown: Promise<void> | undefined;
  const onExit = () => {
    void stop!().catch(() => {
      process.exitCode = 1;
    });
  };
  stop = () => {
    if (shutdown) return shutdown;
    process.removeListener("SIGINT", onExit);
    process.removeListener("SIGTERM", onExit);
    process.stdin.removeListener("end", onExit);
    shutdown = (async () => {
      try {
        await handle.close();
      } finally {
        await attachment.close();
      }
    })();
    return shutdown;
  };
  process.once("SIGINT", onExit);
  process.once("SIGTERM", onExit);
  process.stdin.once("end", onExit);
  return stop;
}

export function main(argv: readonly string[] = process.argv.slice(2)): void {
  const scopeArg = argv.find((arg) => arg.startsWith("--scope="));
  const scopes = scopeArg ? scopeArg.slice("--scope=".length).split(",") : [];
  serve({
    roots: resolveRoots(argv, process.cwd()),
    ...(scopes.length > 0 ? { scopes } : {}),
  });
}

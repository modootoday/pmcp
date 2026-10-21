import { McpAuthError } from "./_shared.js";
import { readCredentials } from "./store/files.js";
import type { Environment, Session } from "./types.js";

export function boundSession(
  name: string,
  serverUrl: string,
  env: Environment,
): Session | undefined {
  const session = readCredentials(name, env).session;
  if (session && session.serverUrl !== serverUrl)
    throw new McpAuthError(
      "MCP credentials belong to another server URL; log in for the declared URL",
    );
  return session;
}

export function status(
  name: string,
  serverUrl: string,
  env: Environment = process.env,
) {
  const session = boundSession(name, serverUrl, env);
  return {
    present: Boolean(session),
    expiresAt:
      session?.expiresAt === undefined
        ? null
        : new Date(session.expiresAt).toISOString(),
    scopes: session?.scopes ?? [],
  };
}

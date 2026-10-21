import type { ProjectSpec } from "../project/spec.js";
import type { AuthPresence } from "./types.js";

export async function authPresence(
  spec: ProjectSpec,
  env: Readonly<Record<string, string | undefined>>,
): Promise<AuthPresence[]> {
  const servers = Object.entries(spec.mcp).filter(
    ([, server]) => server.auth === "pmcp" && server.url,
  );
  if (!servers.length) return [];
  const { status } = await import("../mcp-auth/status.js");
  return servers.map(([name, server]) => {
    try {
      return { name, ...status(name, server.url!, env) };
    } catch {
      return {
        name,
        present: false,
        expiresAt: null,
        scopes: [],
        error: "Credentials unavailable or invalid; contents redacted",
      };
    }
  });
}

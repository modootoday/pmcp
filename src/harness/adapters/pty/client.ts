import { createConnection } from "node:net";

export type PtyReply = Record<string, unknown>;

// One request line, one reply line, as every one-shot pmcp-pty op answers.
export function ptyRequest(
  socket: string,
  request: Readonly<Record<string, unknown>>,
  limitMs: number,
): Promise<PtyReply> {
  return new Promise((resolve, reject) => {
    const client = createConnection(socket);
    let text = "";
    const timer = setTimeout(() => {
      client.destroy();
      reject(new Error(`no reply from pmcp-pty within ${limitMs} ms`));
    }, limitMs);
    client.on("connect", () => client.write(`${JSON.stringify(request)}\n`));
    client.on("data", (chunk) => {
      text += chunk.toString("utf8");
      const end = text.indexOf("\n");
      if (end < 0) return;
      clearTimeout(timer);
      client.end();
      try {
        resolve(JSON.parse(text.slice(0, end)) as PtyReply);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    client.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

// The same order as pmcp-pty's own default (crates/pmcp-pty/src/paths.rs): PMCP_PTY_SOCKET, so a
// caller inside a hosted session reaches its own host, then the runtime dir, then on macOS
// (no XDG_RUNTIME_DIR) a private directory under the per-user TMPDIR.
export function defaultPtySocket(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform,
  uid: number = process.getuid?.() ?? 0,
): string | undefined {
  if (env["PMCP_PTY_SOCKET"]) return env["PMCP_PTY_SOCKET"];
  const runtime = env["XDG_RUNTIME_DIR"];
  if (runtime) return `${runtime}/pmcp-pty.sock`;
  if (platform !== "darwin") return undefined;
  const tmp = (env["TMPDIR"] || "/tmp").replace(/\/+$/u, "");
  return `${tmp}/pmcp-pty-${uid}/pmcp-pty.sock`;
}

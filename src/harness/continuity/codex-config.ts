import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export function codexConfiguredRoots(
  executable: string,
  cwd: string,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const server = spawn(executable, ["app-server"], {
      cwd,
      stdio: ["pipe", "pipe", "ignore"],
    });
    const lines = createInterface({ input: server.stdout });
    const fail = () => reject(new Error("codex_workspace_config_unavailable"));
    const timeout = setTimeout(() => {
      fail();
      server.kill();
    }, 5_000);
    const send = (message: object) =>
      server.stdin.write(JSON.stringify(message) + "\n");
    server.once("error", fail);
    server.stdin.on("error", fail);
    server.once("close", () => {
      clearTimeout(timeout);
      fail();
    });
    lines.on("line", (line) => {
      try {
        const reply = JSON.parse(line);
        if (reply.id === 1 && reply.result) {
          send({ method: "initialized" });
          send({
            id: 2,
            method: "config/read",
            params: { cwd, includeLayers: false },
          });
          return;
        }
        if (reply.id !== 2) return;
        if (!reply.result?.config) throw new Error("missing Codex config");
        const roots =
          reply.result.config.sandbox_workspace_write?.writable_roots ?? [];
        if (
          !Array.isArray(roots) ||
          roots.some((path) => typeof path !== "string")
        )
          throw new Error("invalid Codex writable roots");
        resolve(roots);
      } catch {
        fail();
      }
      lines.close();
      server.stdin.end();
    });
    send({
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "pmcp", version: "1" } },
    });
  });
}

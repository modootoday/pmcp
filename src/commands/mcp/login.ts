import { createInterface } from "node:readline/promises";
import { ArgumentError, one, type CommandContext } from "../../cli/command.js";
import { beginLogin, completeLogin } from "../../mcp-auth/oauth/login.js";
import { callbackListener } from "../../mcp-auth/oauth/callback.js";
import { storeBearer } from "../../mcp-auth/session.js";

export async function login(
  context: CommandContext,
  name: string,
  url: string,
  bearerEnv?: string,
): Promise<void> {
  const { env, args, ui } = context;
  const bearer = one(args, "bearer-env") ?? bearerEnv;
  if (bearer) {
    await storeBearer(name, url, env[bearer] ?? "", env);
    ui.success(`MCP bearer session stored for ${name}`);
    return;
  }
  const pasted = one(args, "code");
  if (pasted) {
    await completeLogin(name, url, pasted, env);
    ui.success(`MCP OAuth session stored for ${name}`);
    return;
  }
  const noWait = args.flags.has("no-wait");
  const port = Number(one(args, "port") ?? 0);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new ArgumentError("--port must be an integer from 0 to 65535");
  if (noWait) {
    const pending = await beginLogin(
      name,
      url,
      `http://127.0.0.1:${port || 8976}/callback`,
      env,
      one(args, "client-id"),
    );
    ui.data(pending.authorizationUrl + "\n");
    ui.info(
      "Complete authorization, then run pmcp mcp login with --code and the redirected callback URL or pasted code.",
    );
    return;
  }
  const callback = await callbackListener(port);
  let terminal: ReturnType<typeof createInterface> | undefined;
  try {
    const pending = await beginLogin(
      name,
      url,
      callback.redirectUri,
      env,
      one(args, "client-id"),
    );
    ui.data(pending.authorizationUrl + "\n");
    const input = [callback.wait(pending)];
    if (process.stdin.isTTY) {
      terminal = createInterface({
        input: process.stdin,
        output: process.stderr,
      });
      input.push(
        terminal.question(
          "Paste the callback URL or authorization code, or wait for the browser callback: ",
        ),
      );
    }
    await completeLogin(name, url, await Promise.race(input), env);
    ui.success(`MCP OAuth session stored for ${name}`);
  } finally {
    terminal?.close();
    callback.close();
  }
}

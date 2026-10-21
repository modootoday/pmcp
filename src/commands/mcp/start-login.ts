import type { CommandContext } from "../../cli/command.js";
import { login } from "./login.js";
import { serverFrom } from "./server.js";
export async function run(context: CommandContext): Promise<number> {
  const { name, server, url } = serverFrom(context);
  await login(context, name, url, server.bearerTokenEnvVar);
  return 0;
}

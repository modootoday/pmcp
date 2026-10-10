import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { createLoopbackBridge } from "./bridge-listener.js";

const [separator, executable, ...args] = process.argv.slice(2);
const path = process.env.PMCP_HTTPS_PROXY_SOCKET;
if (
  separator !== "--" ||
  !executable ||
  !isAbsolute(executable) ||
  !path ||
  !/^\/state\/e[a-f0-9]{8}$/.test(path)
)
  throw new Error("invalid_egress_bridge_invocation");
const bridge = await createLoopbackBridge(path);
const environment = { ...process.env };
for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"])
  environment[key] = bridge.url;
for (const key of ["http_proxy", "https_proxy", "all_proxy"])
  environment[key] = bridge.url;
environment.NO_PROXY = "";
environment.no_proxy = "";
const child = spawn(executable, args, {
  env: environment,
  stdio: "inherit",
});
process.on("SIGTERM", () => child.kill("SIGTERM"));
process.on("SIGINT", () => child.kill("SIGINT"));
child.once("error", async () => {
  await bridge.close();
  process.exitCode = 1;
});
child.once("exit", async (code) => {
  await bridge.close();
  process.exitCode = code ?? 1;
});

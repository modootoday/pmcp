import type { Receipt } from "../contracts.js";
import { runtimeExecutables } from "../runtimes/registry.js";
import { locateExecutable } from "../adapters/process/executable.js";
import { nativeHostTools } from "../adapters/systemd/admission.js";
import { ptyBinary } from "../../project/host.js";

export function capabilities(): Receipt {
  return {
    runtimes: Object.entries(runtimeExecutables).map(
      ([runtime, executable]) => ({
        runtime,
        executable,
        executablePath: locateExecutable(executable),
        authenticationManaged: false,
        automaticWakeQualified: false,
        providerStateQualified: false,
      }),
    ),
    nativeUiPreserved: true,
    controlBoundary: "optional-cli-only",
    requiredTools: [...nativeHostTools],
    multilineInputQualified: false,
  };
}

export function doctor(): Receipt {
  const tools = process.platform === "linux" ? [...nativeHostTools] : [];
  return {
    ...capabilities(),
    platform: process.platform,
    terminalHost: ptyBinary(process.env),
    memoryCapped: process.platform === "linux",
    tools: tools.map((executable) => ({
      executable,
      path: locateExecutable(executable),
    })),
    userBusConfigured: Boolean(process.env.DBUS_SESSION_BUS_ADDRESS),
    providerInvoked: false,
  };
}

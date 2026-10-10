import type { Receipt } from "../contracts.js";
import { runtimeExecutables } from "../runtimes/registry.js";
import { locateExecutable } from "../adapters/process/executable.js";
import { nativeHostTools } from "../adapters/systemd/admission.js";

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
  return {
    ...capabilities(),
    platform: process.platform,
    tools: nativeHostTools.map((executable) => ({
      executable,
      path: locateExecutable(executable),
    })),
    userBusConfigured: Boolean(process.env.DBUS_SESSION_BUS_ADDRESS),
    providerInvoked: false,
  };
}

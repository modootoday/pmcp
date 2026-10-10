import { isAbsolute, posix } from "node:path";
import { object, strings, text } from "../validation.js";

export interface EgressPolicy {
  hosts: string[];
  bridgeExecutable?: string;
}

export function egressPolicy(value: unknown): EgressPolicy {
  const policy = object(value);
  const hosts = strings(policy.hosts, "egress_hosts").map((host) =>
    host.toLowerCase(),
  );
  if (hosts.length > 16 || new Set(hosts).size !== hosts.length)
    throw new Error("invalid_egress_hosts");
  for (const host of hosts) {
    if (
      host.length > 253 ||
      !host.includes(".") ||
      /^[0-9.]+$/.test(host) ||
      !host
        .split(".")
        .every((label) =>
          /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
        ) ||
      /\.(local|localhost|internal|invalid|test)$/.test(host)
    )
      throw new Error("invalid_egress_host");
  }
  if (policy.bridgeExecutable === undefined) return { hosts };
  const executable = text(policy.bridgeExecutable, "egress_bridge_executable");
  if (
    !isAbsolute(executable) ||
    posix.normalize(executable) !== executable ||
    /[\r\n\x1b]/.test(executable)
  )
    throw new Error("invalid_egress_bridge_executable");
  return { hosts, bridgeExecutable: executable };
}

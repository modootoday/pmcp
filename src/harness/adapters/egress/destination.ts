import { BlockList, isIP } from "node:net";

const denied = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  denied.addSubnet(network, prefix, "ipv4");

export function publicAddress(address: string): boolean {
  return isIP(address) === 4 && !denied.check(address, "ipv4");
}

export function destination(
  header: Buffer,
  hosts: readonly string[],
): string | undefined {
  if (header.some((value) => value > 127 || value === 0)) return;
  const firstLine = header.toString("ascii").split("\r\n")[0] ?? "";
  const match = /^CONNECT ([a-z0-9.-]+):443 HTTP\/1\.[01]$/i.exec(firstLine);
  const host = match?.[1]?.toLowerCase();
  if (!host || !hosts.includes(host)) return;
  return host;
}

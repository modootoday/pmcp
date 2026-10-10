import { lookup } from "node:dns/promises";
import { connect, type Socket } from "node:net";
import { publicAddress } from "./destination.js";

export interface EgressEvent {
  host?: string;
  allowed: boolean;
  reason?: string;
}

export async function openTunnel(
  client: Socket,
  host: string,
  initial: Buffer,
  sockets: Set<Socket>,
  record: (event: EgressEvent) => void,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = await Promise.race([
      lookup(host, { family: 4, all: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("egress_dns_timeout")), 5000);
      }),
    ]);
    if (client.destroyed) return;
    if (
      !addresses.length ||
      addresses.some((value) => !publicAddress(value.address))
    )
      throw new Error("non_public_destination");
    const upstream = connect({ host: addresses[0]!.address, port: 443 });
    sockets.add(upstream);
    upstream.once("close", () => sockets.delete(upstream));
    upstream.setTimeout(60000, () => upstream.destroy());
    upstream.once("error", () => client.destroy());
    client.once("close", () => upstream.destroy());
    upstream.once("close", () => client.destroy());
    upstream.once("connect", () => {
      if (client.destroyed) {
        upstream.destroy();
        return;
      }
      record({ host, allowed: true });
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (initial.length) upstream.write(initial);
      client.pipe(upstream);
      upstream.pipe(client);
    });
  } catch {
    if (client.destroyed) return;
    record({ host, allowed: false, reason: "destination_resolution_failed" });
    client.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n", () =>
      client.destroy(),
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}

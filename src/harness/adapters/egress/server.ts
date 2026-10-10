import { createServer, type Socket } from "node:net";
import { destination } from "./destination.js";
import { listenPrivateSocket } from "./socket.js";
import { openTunnel, type EgressEvent } from "./tunnel.js";
import { egressPolicy } from "../../runtimes/egress-policy.js";

export async function createEgressProxy(
  directory: string,
  name: string,
  hosts: string[],
  onEvent: (events: EgressEvent[]) => void,
) {
  const policy = egressPolicy({ hosts });
  const sockets = new Set<Socket>();
  const events: EgressEvent[] = [];
  const record = (event: EgressEvent) => {
    if (events.length >= 128) events.shift();
    events.push(event);
    onEvent([...events]);
  };
  const server = createServer((client) => {
    if (sockets.size >= 16) {
      client.destroy();
      return;
    }
    sockets.add(client);
    client.once("close", () => sockets.delete(client));
    client.on("error", () => {});
    client.setTimeout(60000, () => client.destroy());
    let buffer = Buffer.alloc(0);
    function headers(chunk: Buffer): void {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 16384) {
        client.destroy();
        return;
      }
      const boundary = buffer.indexOf("\r\n\r\n");
      if (boundary < 0) return;
      client.off("data", headers);
      client.pause();
      const host = destination(buffer.subarray(0, boundary), policy.hosts);
      if (!host) {
        record({ allowed: false, reason: "destination_not_allowed" });
        client.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n", () =>
          client.destroy(),
        );
        return;
      }
      void openTunnel(
        client,
        host,
        buffer.subarray(boundary + 4),
        sockets,
        record,
      );
    }
    client.on("data", headers);
  });
  const release = await listenPrivateSocket(server, directory, name);
  return {
    async close(): Promise<void> {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      release();
    },
  };
}

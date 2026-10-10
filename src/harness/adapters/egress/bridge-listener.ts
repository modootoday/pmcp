import { connect, createServer, type Socket } from "node:net";

export async function createLoopbackBridge(path: string) {
  const sockets = new Set<Socket>();
  const server = createServer((client) => {
    if (sockets.size >= 32) {
      client.destroy();
      return;
    }
    const upstream = connect(path);
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      socket.setTimeout(60000, () => socket.destroy());
      socket.on("error", () => {
        client.destroy();
        upstream.destroy();
      });
    }
    client.once("close", () => upstream.destroy());
    upstream.once("close", () => client.destroy());
    client.pipe(upstream);
    upstream.pipe(client);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("invalid_egress_bridge_address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close(): Promise<void> {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

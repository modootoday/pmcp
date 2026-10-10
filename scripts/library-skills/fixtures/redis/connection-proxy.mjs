import { createConnection, createServer } from "node:net";

export async function createConnectionProxy(endpoint) {
  const sockets = new Set();
  let suspended = false;
  const server = createServer((incoming) => {
    if (suspended) {
      incoming.destroy();
      return;
    }
    const outgoing = createConnection({
      host: endpoint.hostname.replace(/^\[|\]$/gu, ""),
      port: Number(endpoint.port),
    });
    for (const socket of [incoming, outgoing]) {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {
        incoming.destroy();
        outgoing.destroy();
      });
    }
    incoming.pipe(outgoing);
    outgoing.pipe(incoming);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const url = new URL(endpoint);
  url.hostname = "127.0.0.1";
  url.port = String(server.address().port);
  return {
    url: url.href,
    suspend() {
      suspended = true;
      for (const socket of sockets) socket.destroy();
    },
    resume() {
      suspended = false;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) return reject(error);
          resolve();
        });
      });
    },
  };
}

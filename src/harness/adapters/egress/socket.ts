import { chmodSync, closeSync, constants, fstatSync, openSync } from "node:fs";
import { join } from "node:path";
import type { Server } from "node:net";

export async function listenPrivateSocket(
  server: Server,
  directory: string,
  name: string,
): Promise<() => void> {
  if (!/^e[a-f0-9]{8}$/.test(name))
    throw new Error("invalid_egress_socket_name");
  const descriptor = openSync(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  const stat = fstatSync(descriptor);
  if (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) {
    closeSync(descriptor);
    throw new Error("unsafe_egress_directory");
  }
  const path = join(`/proc/self/fd/${descriptor}`, name);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(path, resolve);
    });
    chmodSync(path, 0o600);
  } catch (error) {
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    closeSync(descriptor);
    throw error;
  }
  return () => closeSync(descriptor);
}

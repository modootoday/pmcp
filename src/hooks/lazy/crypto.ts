// The hook bundle resolves node:crypto here, so loading it (about 8 ms) is paid only by an
// event that actually hashes; the integrity check skips hashing when its verdict is cached.
import type * as Crypto from "node:crypto";

const real = (): typeof Crypto => process.getBuiltinModule("node:crypto");

export const createHash: typeof Crypto.createHash = ((
  ...args: Parameters<typeof Crypto.createHash>
) => real().createHash(...args)) as typeof Crypto.createHash;

export const randomBytes: typeof Crypto.randomBytes = ((
  ...args: Parameters<typeof Crypto.randomBytes>
) =>
  (real().randomBytes as (...a: unknown[]) => Buffer)(
    ...args,
  )) as typeof Crypto.randomBytes;

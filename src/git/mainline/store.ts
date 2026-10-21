import { createFilesStore } from "../../sessions/files-store.js";
import type { Lease, SessionStore } from "../../sessions/types.js";

export type { Lease, Pause } from "../../sessions/types.js";

export interface SessionGate {
  readonly pause: Pick<SessionStore["pause"], "read">;
  readonly leases: {
    read(name: string): Lease | null;
    take(name: string, lease: Lease): boolean;
    release(name: string): void;
  };
}

// Share the store so hook refusals observe the leases acquired by delivery.
export function filesSessionGate(stateDir: string): SessionGate {
  const store = createFilesStore(stateDir);
  return {
    pause: store.pause,
    leases: {
      read: (name) => store.leases.read(name),
      take: (name, lease) => store.leases.take(name, lease),
      release: (name) => store.leases.release(name),
    },
  };
}

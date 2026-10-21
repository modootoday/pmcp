import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { installSpec, installState, lockHash } from "../install.js";
import { leaseSpecs, type GitSetup } from "../setup.js";
import type { Delivery } from "./deliver.js";

// One line per lease a delivery changed, in the lease's events file when one is declared:
// {at, subject, commit, hash, installed, lease}. commit is the delivered upstream; hash is the
// leased files' hash in the main checkout after sync; installed says sync's install has run
// for exactly that hash there. A prompt hook can show the latest one to every session.
export function deliveryEvents(setup: GitSetup): (delivery: Delivery) => void {
  return (delivery) => {
    const specs = leaseSpecs(setup.config);
    const sync = setup.config.sync;
    const root = setup.ctx.mainRoot;
    for (const name of delivery.leases) {
      const events = setup.leaseFiles[name]?.events;
      if (!events) continue;
      const paths = specs.find((spec) => spec.name === name)?.paths ?? [];
      // The same stamp and hash sync writes, so another tool reading either agrees with it.
      const spec = installSpec(sync, setup.stateDir);
      const state = spec
        ? installState(root, spec)
        : { hash: lockHash(root, paths), installed: false };
      const { hash, installed } = state;
      mkdirSync(dirname(events), { recursive: true });
      appendFileSync(
        events,
        `${JSON.stringify({
          at: new Date().toISOString(),
          subject: delivery.subject,
          commit: delivery.commit,
          hash,
          installed,
          lease: name,
        })}\n`,
      );
    }
  };
}

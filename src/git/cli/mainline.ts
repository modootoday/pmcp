import { join } from "node:path";

import { deliver, type DeliverReceipt } from "../mainline/deliver.js";
import { deliveryEvents } from "../mainline/delivery-events.js";
import { filesSessionGate } from "../mainline/store.js";
import { detect } from "../detect.js";
import { installSpec } from "../install.js";
import { syncMainline, syncMainlineResult } from "../mainline/sync.js";
import { gateTreePath, leaseSpecs, type GitSetup } from "../setup.js";
import type { Reporter } from "../types.js";
import { checkoutKind, syncDesk } from "../worktrees/desk.js";
import { off, type Action } from "./types.js";

function deskSync(setup: GitSetup, report: Reporter) {
  const { config } = setup;
  const install = installSpec(config.sync, setup.stateDir);
  return syncDesk({
    ctx: setup.ctx,
    followSubmodules: config.submodules?.follow === "clean_pins",
    store: filesSessionGate(setup.stateDir, setup.leaseFiles),
    leases: leaseSpecs(config),
    report,
    ...(install === undefined ? {} : { install }),
    ...(config.umask !== undefined ? { umask: config.umask } : {}),
  });
}

// By checkout kind: the main checkout syncs to the mainline, a desk catches up with it, and
// any other linked worktree is not this command's (exit 2).
export const mainlineSync: Action = (setup, _context, report) => {
  const sync = setup.config.sync ?? off("git.mainline.sync");
  const kind = checkoutKind(setup.ctx, setup.config.worktrees);
  if (kind === "desk") return deskSync(setup, report).code;
  if (kind === "scratch") {
    report.warn(
      `${setup.ctx.root} is a linked worktree but not a desk ([git.worktrees] desks); pmcp git sync moves the main checkout and desks only`,
    );
    return 2;
  }
  const followSubmodules = setup.config.submodules?.follow === "clean_pins";
  const { ctx, stateDir } = setup;
  const sharedSubmodules = setup.config.submodules?.shared ?? [];
  return syncMainline({
    ctx,
    sync,
    followSubmodules,
    sharedSubmodules,
    stateDir,
    report,
    ...(setup.config.umask !== undefined ? { umask: setup.config.umask } : {}),
  });
};

export const mainlineDeliver: Action = (setup, context, report) => {
  const { config, ctx, stateDir } = setup;
  const settings = config.deliver ?? off("git.mainline.deliver");
  const sync = config.sync;
  // The main checkout, when this delivery syncs it: [git.mainline.sync] after_deliver.
  const mainCheckout = () => {
    const when = sync?.afterDeliver ?? "from_main";
    if (sync === undefined || when === "off") return null;
    if (!ctx.linked) return ctx;
    if (when !== "always") return null;
    return detect(ctx.mainRoot, { remote: ctx.remote, mainline: ctx.mainline });
  };
  const afterDeliver = () => {
    const main = mainCheckout();
    if (sync === undefined || main === null) return null;
    const followSubmodules = config.submodules?.follow === "clean_pins";
    const sharedSubmodules = config.submodules?.shared ?? [];
    const synced = syncMainlineResult({
      ctx: main,
      sync,
      followSubmodules,
      sharedSubmodules,
      stateDir,
      report,
      ...(config.umask !== undefined ? { umask: config.umask } : {}),
    });
    if (synced.code !== 0)
      report.warn(
        "delivered; only the main checkout did not catch up, run pmcp git sync there after the refusal above is cleared",
      );
    return synced;
  };
  // The delivering desk itself: [git.worktrees.sync] after_deliver = "desk".
  const afterDeliverDesk = () => {
    if (config.worktreeSync?.afterDeliver !== "desk") return null;
    if (checkoutKind(ctx, config.worktrees) !== "desk") return null;
    const synced = deskSync(setup, report);
    if (synced.code !== 0)
      report.warn(
        "delivered; only this desk did not catch up, run pmcp git sync here after the hold above is cleared",
      );
    return synced;
  };
  return deliver({
    ctx,
    named: context.args.positional.slice(1),
    deliver: settings,
    ...(config.gate === undefined ? {} : { gate: config.gate }),
    tree: gateTreePath(setup),
    // Gate output lives in the state dir whatever the gate tree is, unless log_dir says.
    logDir: join(setup.stateDir, "gate-logs"),
    links: config.worktrees?.linkFromMain ?? [],
    leases: leaseSpecs(config),
    store: filesSessionGate(setup.stateDir, setup.leaseFiles),
    duringPause: context.args.flags.has("during-pause"),
    noPush: context.args.flags.has("no-push"),
    afterDeliver,
    afterDeliverDesk,
    recordDelivery: deliveryEvents(setup),
    pushPins: config.submodules?.push === "pins",
    ...(config.umask !== undefined ? { umask: config.umask } : {}),
    ...(context.args.flags.has("json")
      ? {
          onReceipt: (receipt: DeliverReceipt) =>
            context.ui.data(`${JSON.stringify(receipt)}\n`),
        }
      : {}),
    report,
  });
};

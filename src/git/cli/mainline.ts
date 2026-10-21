import { deliver, type DeliverReceipt } from "../mainline/deliver.js";
import { deliveryEvents } from "../mainline/delivery-events.js";
import { filesSessionGate } from "../mainline/store.js";
import { syncMainline } from "../mainline/sync.js";
import { gateTreePath, leaseSpecs } from "../setup.js";
import { off, type Action } from "./types.js";

export const mainlineSync: Action = (setup, _context, report) => {
  const sync = setup.config.sync ?? off("git.mainline.sync");
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
  });
};

export const mainlineDeliver: Action = (setup, context, report) => {
  const { config, ctx, stateDir } = setup;
  const settings = config.deliver ?? off("git.mainline.deliver");
  const sync = config.sync;
  const afterDeliver = () => {
    if (sync === undefined || ctx.linked) return;
    const followSubmodules = config.submodules?.follow === "clean_pins";
    const sharedSubmodules = config.submodules?.shared ?? [];
    if (
      syncMainline({
        ctx,
        sync,
        followSubmodules,
        sharedSubmodules,
        stateDir,
        report,
      }) !== 0
    )
      report.warn(
        "delivered; only the main checkout did not catch up, run pmcp git sync after the refusal above is cleared",
      );
  };
  return deliver({
    ctx,
    named: context.args.positional.slice(1),
    deliver: settings,
    ...(config.gate === undefined ? {} : { gate: config.gate }),
    tree: gateTreePath(setup),
    links: config.worktrees?.linkFromMain ?? [],
    leases: leaseSpecs(config),
    store: filesSessionGate(setup.stateDir, setup.leaseFiles),
    duringPause: context.args.flags.has("during-pause"),
    afterDeliver,
    recordDelivery: deliveryEvents(setup),
    pushPins: config.submodules?.push === "pins",
    ...(context.args.flags.has("json")
      ? {
          onReceipt: (receipt: DeliverReceipt) =>
            context.ui.data(`${JSON.stringify(receipt)}\n`),
        }
      : {}),
    report,
  });
};

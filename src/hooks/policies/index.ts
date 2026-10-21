import { forcedBranchMove } from "./git/forced-branch-move.js";
import { gateBypassEnv } from "./git/gate-bypass-env.js";
import { pushWithoutVerify } from "./git/push-without-verify.js";
import { stageAll } from "./git/stage-all.js";
import { afterEdit, onStop } from "../checks/index.js";
import { broadcast } from "./sessions/broadcast.js";
import { leases } from "./sessions/leases.js";
import { mailbox } from "./sessions/mailbox.js";
import { pause } from "./sessions/pause.js";
import { registry } from "./sessions/registry.js";
import { roles } from "./sessions/roles.js";
import { composeTeardown } from "./shell/compose-teardown.js";
import { heredoc } from "./shell/heredoc.js";
import { hostApproval } from "./shell/host-approval.js";
import { inPlaceEdit } from "./shell/in-place-edit.js";
import { secretExfiltration } from "./shell/secret-exfiltration.js";
import { stdinInterpreter } from "./shell/stdin-interpreter.js";
import type { Policy, PolicyId } from "./types.js";
import { sharedCheckout } from "./workspace/shared-checkout.js";
import { mainlineDeliver } from "./workspace/mainline-deliver.js";
import { worktreeSync } from "./workspace/worktree-sync.js";

const byId = (list: readonly Policy<any>[]) =>
  Object.fromEntries(list.map((policy) => [policy.id, policy]));

export const GUARDS: Readonly<Record<PolicyId, Policy<any>>> = byId([
  inPlaceEdit,
  heredoc,
  stdinInterpreter,
  composeTeardown,
  hostApproval,
  secretExfiltration,
  pushWithoutVerify,
  forcedBranchMove,
  gateBypassEnv,
  stageAll,
]);

export const FEATURES: Readonly<Record<PolicyId, Policy<any>>> = byId([
  registry,
  pause,
  leases,
  broadcast,
  mailbox,
  roles,
  sharedCheckout,
  worktreeSync,
  mainlineDeliver,
]);

export const POLICIES: Readonly<Record<PolicyId, Policy<any>>> = {
  ...FEATURES,
  ...GUARDS,
  ...byId([afterEdit, onStop]),
};

export { customPolicy } from "./custom.js";

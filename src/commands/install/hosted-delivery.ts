import type { CommandContext } from "../../cli/command.js";
import { invocation } from "../../cli/invocation.js";
import {
  applyInstallPlan,
  createPackageManagerRunner,
} from "../../install/apply.js";
import { readSession } from "../../remote/session.js";
import {
  issueDistributionCredential,
  revokeDistributionCredential,
  temporaryRegistryConfig,
  verifyRegistryIntegrity,
} from "../../remote/distribution.js";
import { apiOrigin } from "../remote-options.js";
import type { InstallOperation } from "./types.js";

export async function applyHosted(
  context: CommandContext,
  operation: InstallOperation,
): Promise<number> {
  const { plan, report, mismatched, reportMismatch } = operation;
  const session = readSession();
  if (
    !session ||
    (session.expiresAt !== undefined && session.expiresAt <= Date.now())
  ) {
    throw new Error(
      `run ${invocation()} login before installing paid skill packages`,
    );
  }
  const origin = apiOrigin(context);
  const credential = await issueDistributionCredential(
    session.accessToken,
    origin,
    fetch,
    plan.changes.map((entry) => entry.packageName),
  );
  const registry = temporaryRegistryConfig(credential);
  let revoked = false;
  try {
    const verified = await verifyRegistryIntegrity(plan.changes, credential);
    const code = applyInstallPlan(
      plan,
      createPackageManagerRunner(
        registry.path,
        { ...process.env, ...registry.environment },
        verified,
      ),
    );
    if (code !== 0) {
      context.ui.error(
        "package manager failed",
        `exit ${code}; inspect the project before retrying`,
      );
      return code;
    }
    const wrong = mismatched(plan.changes.map((change) => change.packageName));
    if (wrong.length > 0) {
      reportMismatch(wrong);
      return 1;
    }
    if (context.args.flags.has("json")) {
      context.ui.data(
        `${JSON.stringify({ status: "applied", ...report }, null, 2)}\n`,
      );
      return 0;
    }
    context.ui.success(`${plan.changes.length} skill packages installed`);
    return 0;
  } finally {
    registry.close();
    revoked = await revokeDistributionCredential(
      session.accessToken,
      credential.id,
      origin,
    );
    if (!revoked)
      context.ui.warn(
        "temporary registry credential expires automatically",
        credential.expiresAt,
      );
  }
}

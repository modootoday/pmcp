import type { InstalledInventory } from "../../installed.js";
import type { InstallPlan } from "../../install/plan.js";
import type { RemoteCatalog } from "../../remote/catalog.js";
import type { verifyInstalledContent } from "../../install/verify-content.js";

export interface InstallOperation {
  readonly project: string;
  readonly provider: "public" | "hosted";
  readonly inventory: InstalledInventory;
  readonly catalog: RemoteCatalog;
  readonly plan: InstallPlan;
  readonly digests: ReadonlyMap<string, string>;
  readonly report: {
    readonly catalogRevision: string;
    readonly project: string;
    readonly changes: InstallPlan["changes"];
    readonly command: InstallPlan["command"];
  };
  mismatched(
    packages: readonly string[],
  ): ReturnType<typeof verifyInstalledContent>[];
  reportMismatch(checks: ReturnType<typeof verifyInstalledContent>[]): void;
}

import type { RemoteCatalog, RemoteEntry } from "../../src/remote/catalog.js";

export interface SkillSelection {
  productId: string;
  major: number;
  title: string;
  summary: string;
  delivery: Pick<RemoteEntry["delivery"], "packageName" | "version">;
  targets: RemoteEntry["targets"];
  status?: NonNullable<RemoteEntry["line"]>["status"];
  preview?: RemoteEntry["preview"];
  repackageMetadataOnly?: boolean;
}

export interface PublicationMetadata {
  revision: string;
  publishedAt: string;
  entries: SkillSelection[];
}

export interface FixtureEvidence {
  verifiedOn: string;
  fixtures: Array<{
    targetPackage: string;
    version: string;
    command: string;
    exitCode: number;
    checks: number;
    skillSha256: string;
  }>;
}

export interface PreparedPublication {
  catalog: RemoteCatalog;
  writes: Array<{ path: string; bytes: Buffer; immutable?: boolean }>;
  selected: string[];
}

export function preparePublication(
  root: string,
  metadata: PublicationMetadata,
  evidence?: { entries: Record<string, FixtureEvidence> },
): PreparedPublication;
export function writePublication(prepared: PreparedPublication): {
  selected: string[];
  revision: string;
};

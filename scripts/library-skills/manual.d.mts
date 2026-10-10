export interface ManualLibraryDescriptor {
  ecosystem: "pypi" | "crates" | "go";
  library: string;
  version: string;
  path: string;
}

export interface ManualLibrarySkill extends ManualLibraryDescriptor {
  identity: string;
  name: string;
  source: string;
  files: Map<string, Buffer>;
}

export const manualLibraryDescriptors: ManualLibraryDescriptor[];
export function readManualLibrarySkills(
  root: string,
  catalog: {
    entries: readonly {
      productId: string;
      targets: readonly { packageName: string }[];
    }[];
  },
): ManualLibrarySkill[];
export function manualPageResources(
  pilots: readonly ManualLibrarySkill[],
): Map<string, Buffer>;

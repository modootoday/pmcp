export function staleGenerated(
  root: string,
  files: ReadonlyMap<string, Buffer>,
): string[];
export function marketplaceProjections(
  root: string,
): Promise<{ descriptors: unknown[]; files: Map<string, Buffer> }>;
export function applyMarketplaceProjections(
  root: string,
  check?: boolean,
): Promise<{ plugins: number; files: number; changed: number }>;

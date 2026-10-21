export interface RedisVerificationOptions {
  readonly scratchRoot: string;
  readonly redisUrl?: string;
}
export interface RedisVerificationResult {
  readonly productId: string;
  readonly companionProductIds: readonly string[];
  readonly verifiedOn: string;
  readonly verifiedVersions: readonly string[];
  readonly packages: Readonly<Record<string, string>>;
  readonly examplesExecuted: number;
  readonly checks: readonly string[];
  readonly environment: string;
  readonly evidenceDirectory: string;
}

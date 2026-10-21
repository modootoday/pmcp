export const BUCKETS = ["allow", "ask", "deny"] as const;

export type Bucket = (typeof BUCKETS)[number];

export interface PermissionSpec {
  readonly claude: Readonly<Partial<Record<Bucket, readonly string[]>>>;
}

export interface BucketPlan {
  readonly bucket: Bucket;
  readonly value: readonly string[];
  readonly managed: readonly string[];
  readonly borrowed: readonly string[];
  readonly drift: readonly string[];
  readonly conflicts: readonly string[];
}

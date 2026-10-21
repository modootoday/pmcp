export interface LockEntry {
  readonly path: string;
  readonly kind: string;
  readonly target?: string;
  readonly managed?: readonly unknown[];
}

export interface ProjectResult {
  readonly backup?: string;

  readonly code: 0 | 2 | 3;
  readonly problems: readonly string[];
  readonly warnings?: readonly string[];
  readonly outputs: number;
  readonly pruned: number;
}

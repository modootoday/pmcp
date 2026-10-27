export interface Finding {
  readonly path: string;
  readonly reason: string;
  readonly level: "error" | "warning";
}

export const PROFILES = ["catalog-v1", "library"] as const;
export type ValidationProfile = (typeof PROFILES)[number];

/** [catalog.validation]; an empty object keeps the Agent Skills specification check alone. */
export interface ValidationSettings {
  readonly profile?: ValidationProfile;
  /** Absolute path of a file listing terms no skill may contain, one per line. */
  readonly denyList?: string;
  /** The tier names a catalog may use, lowest first; catalog-v1 checks against them. */
  readonly tiers?: readonly string[];
}

export interface IssuerMetadata {
  readonly token_endpoint: string;
  readonly device_authorization_endpoint: string;
  readonly revocation_endpoint?: string;
  readonly grant_types_supported?: readonly string[];
  readonly scopes_supported?: readonly string[];
}
export interface DeviceStart {
  readonly userCode: string;
  readonly verificationUri: string;
  readonly verificationUriComplete?: string;
  readonly deviceCode: string;
  readonly intervalMs: number;
  readonly expiresAt: number;
}
export interface StoredSession {
  readonly issuer: string;
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt?: number;
  readonly scope?: string;
}
export type Fetcher = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;
export interface PollOutcome {
  readonly kind: "granted" | "pending" | "slow_down" | "denied" | "expired";
  readonly session?: StoredSession;
}

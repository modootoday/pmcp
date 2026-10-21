export type Environment = Readonly<Record<string, string | undefined>>;

export interface OAuthClient {
  issuer: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  clientId: string;
  clientSecret?: string;
}

export interface Session {
  serverUrl: string;
  kind: "oauth" | "bearer";
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes: string[];
  oauth?: OAuthClient;
}

export interface PendingLogin {
  serverUrl: string;
  state: string;
  verifier: string;
  redirectUri: string;
  authorizationUrl: string;
  expiresAt: number;
  scopes: string[];
  oauth: OAuthClient;
}

export interface CredentialRecord {
  session?: Session;
  pending?: PendingLogin;
  pendingLogins?: PendingLogin[];
}

export interface OAuthMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  revocation_endpoint?: string;
  code_challenge_methods_supported?: string[];
  scopes_supported?: string[];
}

export interface FakeState {
  issued: number;
  refreshes: number;
  calls: number;
  revoked: boolean;
  forbid: boolean;
  pkce: boolean;
  sse: boolean;
  fail: boolean;
  challenge?: string;
  accessToken?: string;
  refreshToken?: string;
  resource: string;
  sessions: Set<string>;
}

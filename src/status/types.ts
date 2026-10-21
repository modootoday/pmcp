export interface Feature {
  feature: string;
  enabled: boolean;
  source: string;
}
export interface AuthPresence {
  name: string;
  present: boolean;
  expiresAt: string | null;
  scopes: readonly string[];
  error?: string;
}

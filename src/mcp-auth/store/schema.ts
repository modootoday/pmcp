import { z } from "zod";

const text = z.string().min(1);
const oauth = z.object({
  issuer: text,
  tokenEndpoint: text,
  revocationEndpoint: text.optional(),
  clientId: text,
  clientSecret: text.optional(),
});
const scopes = z.array(z.string());
const pendingLogin = z.object({
  serverUrl: text,
  state: text,
  verifier: text,
  redirectUri: text,
  authorizationUrl: text,
  expiresAt: z.number().finite(),
  scopes,
  oauth,
});
export const credentialRecord = z.object({
  session: z
    .object({
      serverUrl: text,
      kind: z.enum(["oauth", "bearer"]),
      accessToken: text,
      refreshToken: text.optional(),
      expiresAt: z.number().finite().optional(),
      scopes,
      oauth: oauth.optional(),
    })
    .optional(),
  pending: pendingLogin.optional(),
  pendingLogins: z.array(pendingLogin).max(8).optional(),
});

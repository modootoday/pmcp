import { expect, it } from "vitest";
import {
  audienceMismatch,
  pollOnce,
  refresh,
  type Fetcher,
  type IssuerMetadata,
} from "../src/remote/session.js";

const ISSUER = "https://auth.pmcp.build";
const metadata: IssuerMetadata = {
  token_endpoint: `${ISSUER}/api/oauth/token`,
  device_authorization_endpoint: `${ISSUER}/api/oauth/device_authorization`,
};
const reply = (body: unknown, ok = true, status = 200): ReturnType<Fetcher> =>
  Promise.resolve({ ok, status, json: async () => body });

it("lets a session reach the API origin it was granted for", () => {
  const session = {
    issuer: ISSUER,
    resource: "https://api.example.test",
    accessToken: "a",
  };
  expect(audienceMismatch(session, "https://api.example.test/")).toBeNull();
});

it("refuses to send a session to another API origin", () => {
  const session = {
    issuer: ISSUER,
    resource: "https://api.pmcp.build",
    accessToken: "a",
  };
  const refusal = audienceMismatch(session, "https://evil.example.test");
  expect(refusal).toContain("https://api.pmcp.build");
  expect(refusal).toContain("PMCP_OAUTH_RESOURCE=https://evil.example.test");
  expect(refusal).not.toContain("a,");
});

it("treats a session saved without a resource as granted for the default API", () => {
  const legacy = { issuer: ISSUER, accessToken: "a" };
  expect(audienceMismatch(legacy, "https://api.pmcp.build")).toBeNull();
  expect(audienceMismatch(legacy, "https://api.example.test")).not.toBeNull();
});

it("records the requested resource on a granted device session", async () => {
  const outcome = await pollOnce(
    metadata,
    {
      clientId: "client",
      deviceCode: "code",
      issuer: ISSUER,
      resource: "https://api.example.test",
    },
    () => reply({ access_token: "token" }),
  );
  expect(outcome.session?.resource).toBe("https://api.example.test");
});

it("keeps the resource when a session is refreshed", async () => {
  const renewed = await refresh(
    metadata,
    {
      issuer: ISSUER,
      resource: "https://api.example.test",
      accessToken: "old",
      refreshToken: "r",
    },
    "client",
    () => reply({ access_token: "new" }),
  );
  expect(renewed?.resource).toBe("https://api.example.test");
});

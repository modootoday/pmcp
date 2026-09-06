import { expect, it } from "vitest";
import {
  discover,
  refresh,
  revoke,
  type Fetcher,
  type IssuerMetadata,
} from "../src/remote/session.js";

const ISSUER = "https://auth.pmcp.build";
const metadata: IssuerMetadata = {
  token_endpoint: `${ISSUER}/api/oauth/token`,
  device_authorization_endpoint: `${ISSUER}/api/oauth/device_authorization`,
};
const stored = {
  issuer: ISSUER,
  accessToken: "old-access",
  refreshToken: "old-refresh",
  scope: "catalog:read",
};
const reply = (body: unknown, ok = true, status = 200): ReturnType<Fetcher> =>
  Promise.resolve({ ok, status, json: async () => body });

it("renews the access token and adopts a rotated refresh token", async () => {
  let sent: string | undefined;
  const rotated = await refresh(
    metadata,
    stored,
    "client",
    (_url, init) => {
      sent = init?.body;
      return reply({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 600,
      });
    },
    () => 1000,
  );
  expect(rotated).toEqual({
    issuer: ISSUER,
    accessToken: "new-access",
    refreshToken: "new-refresh",
    expiresAt: 601000,
    scope: "catalog:read",
  });
  expect(sent).toContain("grant_type=refresh_token");
  expect(sent).toContain("refresh_token=old-refresh");
});

it("keeps the current refresh token when the server does not rotate it", async () => {
  const renewed = await refresh(metadata, stored, "client", () =>
    reply({ access_token: "new-access" }),
  );
  expect(renewed?.refreshToken).toBe("old-refresh");
  expect(renewed?.expiresAt).toBeUndefined();
});

it("reports failure rather than a half-updated session", async () => {
  expect(
    await refresh(
      metadata,
      { issuer: ISSUER, accessToken: "a" },
      "client",
      () => reply({}),
    ),
  ).toBeNull();
  expect(
    await refresh(metadata, stored, "client", () =>
      reply({ error: "invalid_grant" }, false, 400),
    ),
  ).toBeNull();
  expect(
    await refresh(metadata, stored, "client", () =>
      reply({ access_token: "" }),
    ),
  ).toBeNull();
  expect(
    await refresh(metadata, stored, "client", () => {
      throw new Error("offline");
    }),
  ).toBeNull();
});

it("refuses a token endpoint that leaves the issuer origin", async () => {
  const elsewhere = {
    ...metadata,
    token_endpoint: "https://attacker.example/token",
  };
  await expect(
    refresh(elsewhere, stored, "client", () => reply({ access_token: "x" })),
  ).rejects.toThrow("issuer origin");
});

it("refuses a discovery document that points its endpoints elsewhere", async () => {
  const served =
    (body: unknown): Fetcher =>
    () =>
      reply(body);
  await expect(
    discover(
      ISSUER,
      served({
        token_endpoint: "https://attacker.example/token",
        device_authorization_endpoint: metadata.device_authorization_endpoint,
      }),
    ),
  ).rejects.toThrow("issuer origin");
  await expect(
    discover(
      ISSUER,
      served({
        ...metadata,
        revocation_endpoint: "http://auth.pmcp.build/revoke",
      }),
    ),
  ).rejects.toThrow("issuer origin");
  await expect(
    discover("http://auth.pmcp.build", served(metadata)),
  ).rejects.toThrow("HTTPS");
  await expect(discover(ISSUER, served(metadata))).resolves.toMatchObject({
    token_endpoint: metadata.token_endpoint,
  });
});

it("revokes the refresh token as well as the access token on logout", async () => {
  const sent: string[] = [];
  const endpoint = {
    ...metadata,
    revocation_endpoint: `${ISSUER}/api/oauth/revoke`,
  };
  const ok = await revoke(endpoint, stored, "client", (_url, init) => {
    sent.push(init?.body ?? "");
    return reply({});
  });
  expect(ok).toBe(true);
  expect(sent).toHaveLength(2);
  expect(sent[0]).toContain("token=old-refresh");
  expect(sent[1]).toContain("token=old-access");
});

it("reports an incomplete logout rather than claiming success", async () => {
  const endpoint = {
    ...metadata,
    revocation_endpoint: `${ISSUER}/api/oauth/revoke`,
  };
  let call = 0;
  const partial = await revoke(endpoint, stored, "client", () => {
    call += 1;
    return reply({}, call === 1, call === 1 ? 200 : 500);
  });
  expect(partial).toBe(false);
  expect(await revoke(metadata, stored, "client", () => reply({}))).toBe(false);
  const elsewhere = {
    ...metadata,
    revocation_endpoint: "https://attacker.example/revoke",
  };
  await expect(
    revoke(elsewhere, stored, "client", () => reply({})),
  ).rejects.toThrow("issuer origin");
});

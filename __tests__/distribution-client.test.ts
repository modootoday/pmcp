import { existsSync, readFileSync, statSync } from "node:fs";
import { expect, it } from "vitest";
import {
  issueDistributionCredential,
  revokeDistributionCredential,
  temporaryRegistryConfig,
} from "../src/remote/distribution.js";

const credential = {
  id: "11111111-1111-4111-8111-111111111111",
  token: `pmcp_${"a".repeat(43)}`,
  registry: "https://api.pmcp.build/npm/",
  scope: "@pmcp",
  expiresAt: "2026-09-07T00:00:00.000Z",
};

it("issues a credential with OAuth without placing the token in the URL or body", async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const fetcher = (async (input, init) => {
    request = { url: String(input), init };
    return Response.json({ schemaVersion: 1, requestId: "test", credential }, { status: 201 });
  }) as typeof fetch;
  expect(await issueDistributionCredential("oauth-secret", "https://api.pmcp.build", fetcher)).toEqual(credential);
  expect(request?.url).toBe("https://api.pmcp.build/v1/distribution/credentials");
  expect(request?.init?.body).toBeUndefined();
  expect(new Headers(request?.init?.headers).get("authorization")).toBe("Bearer oauth-secret");
});

it("distinguishes login, subscription and dependency failures", async () => {
  const status = (code: number) => (async () => Response.json({}, { status: code })) as typeof fetch;
  await expect(issueDistributionCredential("x", undefined, status(401))).rejects.toThrow("sign in");
  await expect(issueDistributionCredential("x", undefined, status(403))).rejects.toThrow("subscription");
  await expect(issueDistributionCredential("x", undefined, status(503))).rejects.toThrow("503");
});

it("writes credentials only into a temporary mode-600 config and removes it", () => {
  const config = temporaryRegistryConfig(credential);
  try {
    const text = readFileSync(config.path, "utf8");
    expect(text).toContain("@pmcp:registry=https://api.pmcp.build/npm/");
    expect(text).toContain(credential.token);
    expect((statSync(config.path).mode & 0o777).toString(8)).toBe("600");
    expect(config.environment.HOME).toBe(config.path.slice(0, -"/.npmrc".length));
  } finally {
    config.close();
  }
  expect(existsSync(config.path)).toBe(false);
});

it("revocation treats an already missing credential as complete", async () => {
  expect(await revokeDistributionCredential("oauth", credential.id, undefined,
    (async () => Response.json({}, { status: 404 })) as typeof fetch)).toBe(true);
  expect(await revokeDistributionCredential("oauth", credential.id, undefined,
    (async () => { throw new Error("offline"); }) as typeof fetch)).toBe(false);
});

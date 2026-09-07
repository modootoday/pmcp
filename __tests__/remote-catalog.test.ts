import { expect, it } from "vitest";
import {
  catalogEndpoint,
  fetchCatalog,
  MAX_CATALOG_BYTES,
  parseCatalog,
} from "../src/remote/catalog.js";

const response = () => ({
  schemaVersion: 1,
  requestId: "test",
  catalog: {
    revision: "r1",
    publishedAt: "2026-09-06T00:00:00.000Z",
    entries: [
      {
        productId: "example",
        title: "Example",
        summary: "Use example correctly.",
        delivery: {
          packageName: "@modootoday/pmcp-example",
          version: "1.0.0",
          integrity: `sha512-${"A".repeat(86)}==`,
        },
        skillRevision: 1,
        contentDigest:
          "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        targets: [
          {
            packageName: "example",
            range: "^2.0.0",
            verifiedVersions: ["2.1.0"],
          },
        ],
        secret: "must-not-be-returned",
      },
    ],
  },
});

it("accepts the public wire contract and strips unknown internal fields", () => {
  expect(JSON.stringify(parseCatalog(response()))).not.toContain(
    "must-not-be-returned",
  );
  expect(parseCatalog(response()).entries).toHaveLength(1);
});

it("rejects invalid semver and a verified version outside the declared range", () => {
  const invalid = response();
  invalid.catalog.entries[0]!.targets[0]!.verifiedVersions = ["3.0.0"];
  expect(() => parseCatalog(invalid)).toThrow("invalid catalog");
});

it("rejects duplicate revisions and shell-shaped package names", () => {
  const duplicate = response();
  duplicate.catalog.entries.push(duplicate.catalog.entries[0]!);
  expect(() => parseCatalog(duplicate)).toThrow("duplicate");
  const bad = response();
  bad.catalog.entries[0]!.delivery.packageName = "--install-shell-command";
  expect(() => parseCatalog(bad)).toThrow("invalid catalog");
});

it("never puts credentials or local dependency data in a public index request", async () => {
  let seen: RequestInit | undefined;
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe("https://api.example.com/v1/catalog");
    seen = init;
    return Response.json(response());
  }) as typeof fetch;
  expect((await fetchCatalog("https://api.example.com", fake)).revision).toBe(
    "r1",
  );
  expect(seen?.body).toBeUndefined();
  expect(new Headers(seen?.headers).has("authorization")).toBe(false);
  expect(seen?.redirect).toBe("error");
});

it("counts actual streamed bytes even without a content-length header", async () => {
  let cancelled = false;
  const fake = (async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(MAX_CATALOG_BYTES + 1));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "content-type": "application/json" } },
    )) as typeof fetch;
  await expect(fetchCatalog("https://api.example.com", fake)).rejects.toThrow(
    "exceeds",
  );
  expect(cancelled).toBe(true);
});

it("rejects credential-bearing URLs and insecure origins", () => {
  for (const origin of [
    "http://example.com",
    "https://user:secret@example.com",
    "https://example.com/private",
    "https://example.com/?token=x",
  ]) {
    expect(() => catalogEndpoint(origin)).toThrow();
  }
});

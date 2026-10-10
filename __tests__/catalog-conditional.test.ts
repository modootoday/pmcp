import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  fileCatalogCache,
  memoryCatalogCache,
} from "../src/remote/catalog-cache.js";
import { fetchCatalog } from "../src/remote/catalog.js";

/**
 * The hub has answered If-None-Match since it shipped and the client never
 * sent one, so every command re-downloaded the whole catalog. What is asserted
 * here is bytes, not status codes: a 304 that still shipped a body would pass
 * a check written against the status alone.
 */
const ORIGIN = "https://api.example.com";

const CATALOG = {
  schemaVersion: 1,
  requestId: "test",
  catalog: {
    revision: "r1",
    publishedAt: "2026-09-08T00:00:00.000Z",
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
        evidence: { verifiedOn: "2026-09-07", examplesExecuted: 2 },
        preview: {
          headings: ["When to reach for it"],
          example: "const a = 1;",
        },
        targets: [
          {
            packageName: "example",
            range: "^2.0.0",
            verifiedVersions: ["2.1.0"],
          },
        ],
      },
    ],
  },
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "pmcp-catalog-cache-"));
  dirs.push(dir);
  return dir;
}

/** Records every request, and how many bytes each answer actually carried. */
function hub(): { fetcher: typeof fetch; sent: string[]; bytes: number[] } {
  const sent: string[] = [];
  const bytes: number[] = [];
  const body = JSON.stringify(CATALOG);
  const fetcher = (async (_url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const asked = headers.get("if-none-match");
    sent.push(asked ?? "");
    if (asked === '"r1"') {
      bytes.push(0);
      return new Response(null, { status: 304, headers: { etag: '"r1"' } });
    }
    bytes.push(body.length);
    return new Response(body, {
      status: 200,
      headers: { "content-type": "application/json", etag: '"r1"' },
    });
  }) as unknown as typeof fetch;
  return { fetcher, sent, bytes };
}

it("asks nothing conditional the first time and everything conditional after", async () => {
  const cache = memoryCatalogCache();
  const { fetcher, sent, bytes } = hub();

  const first = await fetchCatalog(ORIGIN, fetcher, cache);
  const second = await fetchCatalog(ORIGIN, fetcher, cache);

  expect(sent).toEqual(["", '"r1"']);
  expect(bytes[1]).toBe(0);
  expect(bytes[0]).toBeGreaterThan(0);
  expect(second.revision).toBe(first.revision);
  expect(second.entries).toEqual(first.entries);
});

it("does not remember an answer that arrived without a tag", async () => {
  const cache = memoryCatalogCache();
  const untagged = (async () =>
    new Response(JSON.stringify(CATALOG), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

  await fetchCatalog(ORIGIN, untagged, cache);
  expect(cache.read(ORIGIN)).toBeNull();
});

it("asks again rather than failing when what it held no longer parses", async () => {
  const cache = memoryCatalogCache();
  cache.write(ORIGIN, { etag: '"r1"', body: "{ this is not a catalog" });
  const { fetcher, sent } = hub();

  // The hub answers 304 to the tag it recognises, so a client that trusted its
  // own copy blindly would have nothing to return and no way forward.
  const catalog = await fetchCatalog(ORIGIN, fetcher, cache);

  expect(catalog.revision).toBe("r1");
  expect(sent).toEqual(['"r1"', ""]);
});

it("keeps one origin, so a second hub replaces the file", () => {
  const dir = scratch();
  const cache = fileCatalogCache(dir);
  cache.write(ORIGIN, { etag: '"r1"', body: "one" });
  cache.write("https://other.example.com", { etag: '"r2"', body: "two" });

  expect(cache.read(ORIGIN)).toBeNull();
  expect(cache.read("https://other.example.com")).toEqual({
    etag: '"r2"',
    body: "two",
  });
});

it("treats an unreadable cache as an empty one", () => {
  const dir = scratch();
  writeFileSync(join(dir, "catalog-cache.json"), "not json at all");
  expect(fileCatalogCache(dir).read(ORIGIN)).toBeNull();
});

it("writes the cache where the credential lives, not in the project", () => {
  const dir = scratch();
  fileCatalogCache(dir).write(ORIGIN, { etag: '"r1"', body: "held" });
  const held: unknown = JSON.parse(
    readFileSync(join(dir, "catalog-cache.json"), "utf8"),
  );
  expect(held).toEqual({ origin: ORIGIN, etag: '"r1"', body: "held" });
});

import { readFileSync, statSync } from "node:fs";
import semver from "semver";
import { z } from "zod";
import {
  memoryCatalogCache,
  type CachedCatalog,
  type CatalogCache,
} from "./catalog-cache.js";

const npmName = z
  .string()
  .max(214)
  .regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u);
const version = z
  .string()
  .refine(
    (value) =>
      semver.valid(value) !== null &&
      semver.valid(value) === value.split("+")[0],
  );
const target = z
  .object({
    packageName: npmName,
    range: z
      .string()
      .min(1)
      .refine((value) => semver.validRange(value) !== null),
    verifiedVersions: z.array(version).min(1),
  })
  .refine((value) =>
    value.verifiedVersions.every((item) => semver.satisfies(item, value.range)),
  );
// Use the owned package namespace so catalog entries cannot point into an unrelated registry scope.
const deliveryName = npmName.refine((value) =>
  value.startsWith("@modootoday/pmcp-"),
);
const entry = z.object({
  productId: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  delivery: z.object({
    packageName: deliveryName,
    version,
    integrity: z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/u),
  }),
  skillRevision: z.number().int().positive(),
  contentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  evidence: z.object({
    verifiedOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .optional(),
    examplesExecuted: z.number().int().positive(),
  }),
  // Keep previews optional so older published snapshots remain readable.
  preview: z
    .object({
      headings: z.array(z.string().min(1)),
      example: z.string().min(1),
    })
    .optional(),
  // Keep standing optional so older catalog entries remain compatible.
  line: z
    .object({
      major: z.number().int().nonnegative(),
      status: z.enum(["active", "frozen", "recalled"]),
      recall: z
        .object({
          advisoryUrl: z.string().url(),
          severity: z.enum(["high", "critical"]),
          summary: z.string().min(1),
          reverifyAt: version.optional(),
        })
        .optional(),
    })
    .optional(),
  targets: z.array(target).min(1),
});
const responseSchema = z.object({
  schemaVersion: z.literal(1),
  requestId: z.string().min(1),
  catalog: z.object({
    revision: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u),
    publishedAt: z.string().datetime(),
    entries: z.array(entry),
  }),
});

export type RemoteCatalog = z.infer<typeof responseSchema>["catalog"];
export type RemoteEntry = RemoteCatalog["entries"][number];
export const MAX_CATALOG_BYTES = 5 * 1024 * 1024;
export const DEFAULT_API_ORIGIN = "https://api.pmcp.build";

export function parseCatalog(value: unknown): RemoteCatalog {
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success)
    throw new Error("the service returned an invalid catalog");
  const identities = new Set<string>();
  for (const entry of parsed.data.catalog.entries) {
    const identity = JSON.stringify([entry.productId, entry.skillRevision]);
    if (identities.has(identity))
      throw new Error("the catalog contains duplicate revisions");
    identities.add(identity);
  }
  return parsed.data.catalog;
}

export function catalogEndpoint(origin: string): string {
  const url = new URL(origin);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "the API origin must be an HTTPS origin without credentials or a path",
    );
  }
  return new URL("/v1/catalog", url).href;
}

export function readCatalogFile(path: string): RemoteCatalog {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > MAX_CATALOG_BYTES)
    throw new Error("catalog file exceeds the supported size");
  const bytes = readFileSync(path);
  if (bytes.byteLength > MAX_CATALOG_BYTES)
    throw new Error("catalog file exceeds the supported size");
  return parseCatalog(JSON.parse(bytes.toString("utf8")));
}

export async function fetchCatalog(
  origin: string,
  fetcher: typeof fetch = fetch,
  cache: CatalogCache = memoryCatalogCache(),
): Promise<RemoteCatalog> {
  const held = cache.read(origin);
  if (held) {
    try {
      return await request(origin, fetcher, held, cache);
    } catch (error) {
      // Ignore unusable cache data so the client can fetch a complete answer.
      if (!(error instanceof StaleCacheError)) throw error;
    }
  }
  return await request(origin, fetcher, null, cache);
}

class StaleCacheError extends Error {}

async function request(
  origin: string,
  fetcher: typeof fetch,
  held: CachedCatalog | null,
  cache: CatalogCache,
): Promise<RemoteCatalog> {
  // Send only the public entity tag so catalog requests disclose no account or dependency information.
  const response = await fetcher(catalogEndpoint(origin), {
    method: "GET",
    headers: held
      ? { accept: "application/json", "if-none-match": held.etag }
      : { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 304) {
    if (!held) throw new Error("catalog answered 304 to an unconditional read");
    try {
      return parseCatalog(JSON.parse(held.body));
    } catch {
      throw new StaleCacheError("the held catalog no longer parses");
    }
  }
  if (!response.ok)
    throw new Error(`catalog request failed (${response.status})`);
  if (
    !response.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    throw new Error("catalog response is not JSON");
  }
  if (!response.body) throw new Error("catalog response has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_CATALOG_BYTES)
        throw new Error("catalog response exceeds the supported size");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  const catalog = parseCatalog(JSON.parse(text));
  // Cache only validated responses so invalid data cannot become a reusable answer.
  const tag = response.headers.get("etag");
  if (tag !== null && tag !== "")
    cache.write(origin, { etag: tag, body: text });
  return catalog;
}

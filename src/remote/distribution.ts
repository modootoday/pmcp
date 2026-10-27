import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catalogEndpoint, DEFAULT_API_ORIGIN } from "./catalog.js";

export interface DistributionCredential {
  readonly id: string;
  readonly token: string;
  readonly registry: string;
  readonly scope: string;
  readonly expiresAt: string;
}
function api(origin: string, path: string): string {
  const base = new URL(catalogEndpoint(origin));
  base.pathname = path;
  return base.href;
}
// A well-formed npm scope; the service names it, and installs stay within `${scope}/pmcp-`.
const SCOPE = /^@[a-z0-9][a-z0-9._-]{0,213}$/u;

// The credential must point at the registry of the service that issued it: `<origin>/npm/`.
function credential(value: unknown, origin: string): DistributionCredential {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid distribution credential response");
  const row = value as Record<string, unknown>;
  if (
    !row["credential"] ||
    typeof row["credential"] !== "object" ||
    Array.isArray(row["credential"])
  ) {
    throw new Error("invalid distribution credential response");
  }
  const item = row["credential"] as Record<string, unknown>;
  for (const key of ["id", "token", "registry", "scope", "expiresAt"]) {
    if (typeof item[key] !== "string" || item[key] === "")
      throw new Error("invalid distribution credential response");
  }
  const registry = new URL(item["registry"] as string);
  if (
    registry.href !== api(origin, "/npm/") ||
    !SCOPE.test(item["scope"] as string) ||
    !/^pmcp_[A-Za-z0-9_-]{43}$/u.test(item["token"] as string) ||
    !Number.isFinite(Date.parse(item["expiresAt"] as string))
  ) {
    throw new Error("invalid distribution credential response");
  }
  return item as unknown as DistributionCredential;
}

const REFUSALS: Readonly<Record<number, string>> = {
  401: "sign in again before installing skills",
  402: "a subscription is needed to install these skills",
  403: "sign in again to approve skill downloads",
};

// The service's own site: its API host, or that host without a leading "api." label.
function serviceHosts(origin: string): Set<string> {
  const host = new URL(origin).host;
  return new Set([host, host.replace(/^api\./u, "")]);
}

// Use service-provided resolution URLs so clients do not retain stale pricing or remediation claims.
function helpUrl(
  body: Record<string, unknown>,
  origin: string,
): string | undefined {
  const error = body["error"];
  if (!error || typeof error !== "object") return undefined;
  const help = (error as Record<string, unknown>)["help"];
  if (!help || typeof help !== "object") return undefined;
  const url = (help as Record<string, unknown>)["subscribeUrl"];
  if (typeof url !== "string") return undefined;
  // Validate resolution URLs so server errors cannot redirect users to unrelated origins.
  const parsed = URL.parse(url);
  if (!parsed || parsed.protocol !== "https:") return undefined;
  return serviceHosts(origin).has(parsed.host) ? parsed.href : undefined;
}

// Preserve request ids so users can correlate refusals with service logs.
async function refusal(
  response: Response,
  fallback: string,
  origin: string,
  subjects: readonly string[] = [],
): Promise<Error> {
  let requestId: string | undefined;
  let where: string | undefined;
  try {
    const body: unknown = await response.json();
    const value =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    if (typeof value["requestId"] === "string" && value["requestId"] !== "") {
      requestId = value["requestId"];
    }
    where = helpUrl(value, origin);
  } catch {
    // A refusal without a body is still a refusal; the status carries it.
  }
  const said = REFUSALS[response.status] ?? `${fallback} (${response.status})`;
  // Identify the refused item so reports describe the requested operation rather than an entire account.
  const named = subjects.length > 0 ? `${said}: ${subjects.join(", ")}` : said;
  return new Error(
    [
      named,
      where ? `subscribe at ${where}` : "",
      requestId ? `[request ${requestId}]` : "",
    ]
      .filter((part) => part !== "")
      .join("\n  "),
  );
}

export async function issueDistributionCredential(
  accessToken: string,
  origin = DEFAULT_API_ORIGIN,
  fetcher: typeof fetch = fetch,
  subjects: readonly string[] = [],
): Promise<DistributionCredential> {
  const response = await fetcher(api(origin, "/v1/distribution/credentials"), {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
    },
  });
  if (!response.ok)
    throw await refusal(
      response,
      "distribution credential request failed",
      origin,
      subjects,
    );
  return credential(await response.json(), origin);
}

export async function verifyRegistryIntegrity(
  entries: readonly {
    packageName: string;
    version: string;
    integrity: string;
  }[],
  value: DistributionCredential,
  fetcher: typeof fetch = fetch,
): Promise<Map<string, string>> {
  const verified = new Map<string, string>();
  for (const entry of entries) {
    // Restrict credentials to skill packages because the organization scope is shared with other products.
    if (!entry.packageName.startsWith(`${value.scope}/pmcp-`))
      throw new Error(
        "catalog delivery name is not a skill package for this credential",
      );
    const endpoint = new URL(
      encodeURIComponent(entry.packageName),
      value.registry,
    );
    const response = await fetcher(endpoint, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        authorization: `Bearer ${value.token}`,
        accept: "application/json",
      },
    });
    if (!response.ok)
      throw await refusal(
        response,
        "registry metadata request failed",
        new URL(value.registry).origin,
      );
    const raw = await response.text();
    if (raw.length > 2 * 1024 * 1024)
      throw new Error("registry metadata exceeds the supported size");
    const body: unknown = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error("registry returned invalid metadata");
    const versions = (body as Record<string, unknown>)["versions"];
    if (!versions || typeof versions !== "object" || Array.isArray(versions))
      throw new Error("registry metadata contains no versions");
    const release = (versions as Record<string, unknown>)[entry.version];
    if (!release || typeof release !== "object" || Array.isArray(release))
      throw new Error("registry does not contain the catalog version");
    const dist = (release as Record<string, unknown>)["dist"];
    if (
      !dist ||
      typeof dist !== "object" ||
      Array.isArray(dist) ||
      (dist as Record<string, unknown>)["integrity"] !== entry.integrity
    ) {
      throw new Error("registry integrity differs from the catalog");
    }
    verified.set(`${entry.packageName}@${entry.version}`, entry.integrity);
  }
  return verified;
}

export async function revokeDistributionCredential(
  accessToken: string,
  id: string,
  origin = DEFAULT_API_ORIGIN,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetcher(api(origin, "/v1/distribution/revoke"), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ id }),
    });
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

export interface RegistryConfig {
  readonly path: string;
  readonly environment: Readonly<Record<string, string>>;
  close(): void;
}

// Use a private temporary npm config so installation credentials do not persist in project files.
export function temporaryRegistryConfig(
  value: DistributionCredential,
): RegistryConfig {
  const directory = mkdtempSync(join(tmpdir(), "pmcp-registry-"));
  chmodSync(directory, 0o700);
  const path = join(directory, ".npmrc");
  const registry = new URL(value.registry);
  const auth = `//${registry.host}${registry.pathname}:_authToken=${value.token}`;
  writeFileSync(path, `${value.scope}:registry=${registry.href}\n${auth}\n`, {
    mode: 0o600,
  });
  chmodSync(path, 0o600);
  return {
    path,
    environment: { HOME: directory },
    close() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

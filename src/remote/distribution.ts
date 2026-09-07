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
function credential(value: unknown): DistributionCredential {
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
    registry.href !== "https://api.pmcp.build/npm/" ||
    item["scope"] !== "@modootoday" ||
    !/^pmcp_[A-Za-z0-9_-]{43}$/u.test(item["token"] as string) ||
    !Number.isFinite(Date.parse(item["expiresAt"] as string))
  ) {
    throw new Error("invalid distribution credential response");
  }
  return item as unknown as DistributionCredential;
}

/** Every refusal the service explains, said back in the caller's terms. */
const REFUSALS: Readonly<Record<number, string>> = {
  401: "sign in again before installing skills",
  402: "a subscription is needed to install these skills",
  403: "sign in again to approve skill downloads",
};

/**
 * Where the service says a refusal is resolved. Only the service knows the
 * price, and a copy of this client compiled with one would keep quoting it
 * after it changed, so nothing here states an amount.
 */
function helpUrl(body: Record<string, unknown>): string | undefined {
  const error = body["error"];
  if (!error || typeof error !== "object") return undefined;
  const help = (error as Record<string, unknown>)["help"];
  if (!help || typeof help !== "object") return undefined;
  const url = (help as Record<string, unknown>)["subscribeUrl"];
  if (typeof url !== "string") return undefined;
  // A refusal must not become a way to send someone anywhere.
  const parsed = URL.parse(url);
  if (!parsed || parsed.protocol !== "https:") return undefined;
  return parsed.host === "pmcp.build" ? parsed.href : undefined;
}

/**
 * The service names the request it refused, and that name is the only thing
 * that ties a report to a server log. Dropping it leaves the person with a
 * sentence and nobody able to look up what happened.
 */
async function refusal(
  response: Response,
  fallback: string,
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
    where = helpUrl(value);
  } catch {
    // A refusal without a body is still a refusal; the status carries it.
  }
  const said = REFUSALS[response.status] ?? `${fallback} (${response.status})`;
  // Naming what was refused is the difference between a sentence about an
  // account and a sentence about the thing the reader asked for.
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
      subjects,
    );
  return credential(await response.json());
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
    // The scope is shared with this organisation's other packages, so the
    // check names the skill prefix: a credential for the scope must not be
    // spent fetching something that is not a skill package.
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
      throw await refusal(response, "registry metadata request failed");
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

/** Token exists only in a mode-600 temporary npm config and is removed after install. */
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

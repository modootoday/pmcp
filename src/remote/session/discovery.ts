import type { IssuerMetadata } from "./types.js";
import type { Fetcher } from "./types.js";
import { DEVICE_GRANT } from "./_shared.js";
export function validateIssuerUrl(value: string, issuer: string): void {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.origin !== new URL(issuer).origin ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error("OAuth endpoint must stay on the issuer origin");
  }
}
export async function discover(
  issuer: string,
  fetcher: Fetcher,
): Promise<IssuerMetadata> {
  const base = issuer.replace(/\/+$/, "");
  const source = new URL(base);
  if (
    source.protocol !== "https:" ||
    source.username ||
    source.password ||
    source.search ||
    source.hash
  ) {
    throw new Error("the issuer must be a plain HTTPS origin");
  }
  const res = await fetcher(`${base}/.well-known/oauth-authorization-server`);
  if (!res.ok)
    throw new Error(`issuer did not answer discovery (${res.status})`);
  const body = (await res.json()) as IssuerMetadata;
  if (!body.token_endpoint || !body.device_authorization_endpoint) {
    throw new Error("issuer advertises no device grant");
  }
  for (const endpoint of [
    body.token_endpoint,
    body.device_authorization_endpoint,
    body.revocation_endpoint,
  ]) {
    if (endpoint !== undefined) validateIssuerUrl(endpoint, base);
  }
  const grants = body.grant_types_supported ?? [];
  if (grants.length > 0 && !grants.includes(DEVICE_GRANT)) {
    throw new Error("issuer does not support the device grant");
  }
  return body;
}

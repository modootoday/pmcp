import assert from "node:assert/strict";
export function isolatedEndpoint(value) {
  assert.ok(
    value,
    "Pass redisUrl or PMCP_SKILL_REDIS_URL for an isolated test service",
  );
  const endpoint = new URL(value);
  assert.equal(endpoint.protocol, "redis:");
  assert.ok(
    ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname),
    "Only explicit loopback test endpoints are permitted",
  );
  assert.ok(endpoint.port, "An explicit isolated service port is required");
  assert.equal(endpoint.search, "");
  assert.match(endpoint.pathname, /^(?:\/\d*)?$/u);
  return endpoint;
}

---
name: proxy-agent
description: Use proxy-agent ^8.0.0 as an ESM proxy-aware Node.js HTTP(S) Agent on Node.js 20+. Covers environment-based and custom proxy selection, exported lazy proxy constructors, lifecycle, and v8 compatibility concerns.
---

Verified against proxy-agent@8.0.2 on 2026-09-08. 3 of 3 examples executed.

# proxy-agent 8.x

## Runtime and module requirements

- `^8.0.0` currently resolves to the 8.x line; the latest listed release is `8.0.2`.
- Node.js 20 or newer is required. Version 8 raised the minimum Node.js version to 20.
- The package is ESM. Import its runtime exports with `import`; do not use the older CommonJS shape.
- The documented runtime exports are `ProxyAgent` and `proxies`. `ProxyAgentOptions` is a TypeScript type export.
- There is no documented CLI. Use the programmatic API or pass the resulting agent to Node's HTTP client.

## Default environment-based proxying

Construct `ProxyAgent` with no options to select an underlying agent from the request URL and the usual `http_proxy`, `https_proxy`, `no_proxy`, and related environment variables. If no proxy is configured for a request, it creates or uses default `http.Agent`/`https.Agent` instances.

```ts pmcp-example
import assert from 'node:assert/strict';
import { ProxyAgent } from 'proxy-agent';

const agent = new ProxyAgent();
assert.equal(typeof agent.connect, 'function');
assert.equal(typeof agent.destroy, 'function');
agent.destroy();
```

Use it as the `agent` option in Node's normal HTTP or HTTPS APIs. For example, pass it as `{ agent }` to `https.get(...)`; the request otherwise works like a normal Node HTTPS request. A real request requires a reachable destination and is therefore not used as a standalone example here.

## Selecting a proxy programmatically

Pass `getProxyForUrl` when proxy selection must be controlled by application code. Its callback receives `(url, req)` and may return a string synchronously or asynchronously. Return an empty string when the request should bypass a proxy.

```ts pmcp-example
import assert from 'node:assert/strict';
import { ProxyAgent } from 'proxy-agent';

let calls = 0;
const agent = new ProxyAgent({
  getProxyForUrl: async (url, req) => {
    calls++;
    assert.equal(typeof url, 'string');
    assert.ok(req);
    return url.startsWith('https:')
      ? 'http://proxy-server-over-tcp.com:3128'
      : '';
  },
});

assert.equal(typeof agent.connect, 'function');
assert.equal(calls, 0); // selection is made when a request is connected
agent.destroy();
```

The callback is evaluated during request handling, not when the `ProxyAgent` is constructed. A proxy URL must identify a supported proxy protocol such as HTTP(S), SOCKS, or PAC; low-level behavior is delegated to the corresponding proxy-agent dependencies.

## Exported lazy agent constructors

`proxies` maps proxy protocols to lazy constructors. Each supported protocol entry is a two-element array: `[forHttpRequests, forHttpsRequests]`. Documented keys include:

- `http`
- `https`
- `socks`
- `socks4`
- `socks4a`
- `socks5`
- `socks5h`
- `pac+data`
- `pac+file`
- `pac+ftp`
- `pac+http`
- `pac+https`

These constructors can be used when integrating lower-level agents directly. The returned values are lazy-constructor results; do not assume they are Node agents with an instance `.destroy()` method.

```ts pmcp-example
import assert from 'node:assert/strict';
import { proxies } from 'proxy-agent';

assert.ok(proxies.http);
assert.equal(proxies.http.length, 2);
assert.equal(typeof proxies.http[0], 'function');
assert.equal(typeof proxies.http[1], 'function');

const httpAgent = await proxies.http[0]();
const httpsAgent = await proxies.http[1]();
assert.ok(httpAgent);
assert.ok(httpsAgent);
```

PAC support is delegated to `pac-proxy-agent`; SOCKS support is delegated to the corresponding SOCKS proxy-agent implementation. Do not assume all protocol-specific behavior is implemented in this package itself.

## Lifecycle and custom agents

`ProxyAgent` exposes:

- `connect(req, opts): Promise<http.Agent>` for selecting or resolving the underlying agent during a request.
- `destroy(): void` for releasing the proxy agent and its cached underlying agents.

The proxy agent uses an LRU cache for proxy agents. Call `destroy()` when the owning client is finished, especially for long-lived applications or when replacing an agent.

`ProxyAgentOptions` also supports custom `httpAgent` and `httpsAgent` values, allowing callers to provide fallback agents for the corresponding request types. The documented construction shape is `new ProxyAgent({ httpAgent, httpsAgent })`; destroy the resulting `ProxyAgent` when it is no longer needed.

## Common version and shape mistakes

- Do not target Node versions below 20: v8 explicitly raised the minimum.
- Do not copy a CommonJS import shape from older examples. v7 had already moved the packages to ESM; v8's major compatibility change is primarily the Node floor, but the published package is still consumed through its ESM export.
- Do not expect a CLI, `describe`, `it`, or runner-provided globals. This package exposes agents and helpers, not a test or command runner.
- Do not treat `ProxyAgent` as a fixed HTTP proxy agent. It chooses an underlying agent per request based on the URL, callback, and proxy environment.
- Do not omit `agent.destroy()` when the `ProxyAgent` is no longer needed.
- Do not call `.destroy()` on values returned by `proxies` lazy constructors unless their actual returned shape provides that method; the documented surface only establishes that they are lazy constructors.
- Do not assume undocumented deep imports are available. The published export surface is the package entry point, with runtime exports `ProxyAgent` and `proxies`.

## Not covered

This skill does not cover detailed proxy URL authentication, exact `no_proxy` matching rules, PAC file contents or evaluation semantics, SOCKS protocol options, the complete `http.Agent`/`https.Agent` option set, or behavior of the delegated low-level agent packages. It also does not cover network-dependent request results or package-maintainer build, test, lint, and packaging commands.

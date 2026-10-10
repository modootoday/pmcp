---
name: pac-proxy-agent
description: Use pac-proxy-agent@^9.0.0 as an ESM Node.js HTTP Agent backed by a PAC file or PAC URI.
---

Verified against pac-proxy-agent@9.1.0 on 2026-09-08. 2 of 2 examples executed.

# pac-proxy-agent

## Scope and runtime

`pac-proxy-agent` provides an `http.Agent` for Node's built-in `http` and `https` modules. It retrieves a PAC file, evaluates it, and selects an HTTP, HTTPS, SOCKS, or direct connection for each request.

The 9.x line requires Node.js 20 or newer and is ESM-only. Import `PacProxyAgent` by name; do not use the CommonJS `require()` shape shown in older examples.

## Constructor

```ts
new PacProxyAgent(uri: string | URL, options?)
```

The PAC source protocols exposed by the package are:

- `pac+data:`
- `pac+file:`
- `pac+ftp:`
- `pac+http:`
- `pac+https:`

The underlying URI is loaded after removing the `pac+` prefix. The constructor also accepts the corresponding underlying URI protocols according to the package source.

Options combine Node `http.Agent` options with PAC resolver, URI-loading, HTTP proxy, HTTPS proxy, and SOCKS proxy options. The package-specific option is:

```ts
fallbackToDirect?: boolean
```

Pass the resulting agent to Node's built-in HTTP APIs with `{ agent }`:

```ts
import * as http from 'http';
import { PacProxyAgent } from 'pac-proxy-agent';

const agent = new PacProxyAgent('pac+https://example.invalid/proxy.pac');
http.get('http://example.invalid/', { agent }, (res) => {
  res.resume();
});
```

A request is needed for connection selection and proxy-agent creation. The package is not itself a request client.

## Resolving a PAC file without making a request

`getResolver()` loads the PAC source lazily and returns the callable `FindProxyForURL` resolver. Calling it directly is useful when code needs to inspect the PAC decision without issuing an HTTP request.

This standalone example uses a `data:` PAC source, so it needs no network or filesystem access:

```ts pmcp-example
import assert from 'node:assert/strict';
import { PacProxyAgent } from 'pac-proxy-agent';

const pac = `
function FindProxyForURL(url, host) {
  if (host === 'internal.example') return 'DIRECT';
  return 'PROXY proxy.example:8080';
}
`;

const agent = new PacProxyAgent(
  `pac+data:text/plain,${encodeURIComponent(pac)}`
);

const resolver = await agent.getResolver();
assert.equal(await resolver('http://internal.example/', 'internal.example'), 'DIRECT');
assert.equal(
  await resolver('http://external.example/', 'external.example'),
  'PROXY proxy.example:8080'
);
```

The resolver is loaded and cached lazily. Reusing the agent allows the implementation to reuse the existing resolver when the PAC content has not changed.

## Static protocol list

The class exposes the PAC protocols it handles through `PacProxyAgent.protocols`:

```ts pmcp-example
import assert from 'node:assert/strict';
import { PacProxyAgent } from 'pac-proxy-agent';

assert.deepEqual(PacProxyAgent.protocols, [
  'pac+data',
  'pac+file',
  'pac+ftp',
  'pac+http',
  'pac+https',
]);
```

## Common mistakes

- Do not copy pre-8.x CommonJS examples. Version 9 is ESM and requires Node.js 20 or newer.
- Do not instantiate the agent with an ordinary PAC URL while forgetting the PAC scheme expected by the package. PAC sources are represented with schemes such as `pac+http:`, `pac+https:`, or `pac+data:`.
- Do not expect `PacProxyAgent` to execute a PAC decision merely by constructing it. PAC loading is lazy; call `getResolver()` or use the agent in a Node HTTP request.
- Do not use `describe`, `it`, `expect`, or runner-provided globals in a direct script. The agent integrates with Node's `http` and `https` APIs rather than providing a test-runner interface.
- Do not assume an agent is a standalone request client. Requests must be made through Node's built-in HTTP APIs with the agent supplied in the request options.
- Do not rely on older 7.x implementation details involving CommonJS imports or the older QuickJS runtime. The 8.x and 9.x lines changed those internals; 9.x uses the package's ESM setup and requires Node 20 or newer.

## What this skill does not cover

This skill does not cover the behavior of the underlying `get-uri`, PAC resolver, QuickJS runtime, HTTP proxy agent, HTTPS proxy agent, or SOCKS proxy agent packages individually. It does not cover PAC-file authoring beyond the resolver examples, proxy authentication, detailed option behavior, error handling, or running real HTTP/HTTPS requests through a network or filesystem-backed PAC source. Those behaviors require the package's own runtime dependencies and an actual Node HTTP request environment.

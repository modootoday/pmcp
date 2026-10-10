---
name: socks-proxy-agent
description: Use socks-proxy-agent ^10.0.0 to create SOCKS agents for Node HTTP clients and compatible integrations.
---

Verified against socks-proxy-agent@10.1.0 on 2026-09-08. 3 of 3 examples executed.

# socks-proxy-agent skill

## Version and module requirements

- This skill targets `socks-proxy-agent` `^10.0.0` (published version covered by the research: `10.1.0`).
- Node.js 20 or newer is required.
- The package is ESM. Use `import`, not the older CommonJS-oriented examples.
- The named runtime export is `SocksProxyAgent`. `SocksProxyAgentOptions` is a type export.

## Constructing an agent

The v10 constructor takes a SOCKS URI (or a `URL`) as its first argument and optional options as its second argument:

```ts
new SocksProxyAgent(uri: string | URL, opts?: SocksProxyAgentOptions)
```

Use a URI such as:

```text
socks://username:password@proxy.example.com
```

Credentials in a URI must be URL-encoded. For example, an `@` in a username is written as `%40`.

The supported protocol strings are:

- `socks`
- `socks4`
- `socks4a`
- `socks5`
- `socks5h`

`socks` defaults to SOCKS5 with hostname resolution performed by the proxy.

```ts pmcp-example
import assert from 'node:assert/strict';
import { SocksProxyAgent } from 'socks-proxy-agent';

const agent = new SocksProxyAgent(
  'socks://your-name%40example.com:secret@proxy.example.com:1080'
);

assert.deepEqual(SocksProxyAgent.protocols, [
  'socks',
  'socks4',
  'socks4a',
  'socks5',
  'socks5h',
]);
assert.equal(typeof agent.proxyUrl, 'string');
assert.equal(agent.proxyUrl, 'socks://your-name%40example.com:secret@proxy.example.com:1080');
assert.equal(typeof agent.shouldLookup, 'boolean');
assert.equal(typeof agent.proxy, 'object');
```

A `URL` object is also accepted:

```ts pmcp-example
import assert from 'node:assert/strict';
import { SocksProxyAgent } from 'socks-proxy-agent';

const proxyUrl = new URL('socks5h://proxy.example.com:1080');
const agent = new SocksProxyAgent(proxyUrl);

assert.equal(typeof agent.proxyUrl, 'string');
assert.equal(agent.proxyUrl, proxyUrl.toString());
assert.equal(agent.proxy.type, 5);
assert.equal(agent.shouldLookup, false);
```

## Options

The second argument can contain SOCKS proxy options, `socketOptions`, and Node HTTP agent options. `socketOptions` is for TCP connection options other than `host` and `port`.

The agent exposes these documented members:

- `shouldLookup: boolean`
- `proxy: SocksProxy`
- `proxyUrl: string`
- `timeout: number | null`
- `socketOptions: SocksSocketOptions | null`
- `connect(req, opts): Promise<net.Socket>`

```ts pmcp-example
import assert from 'node:assert/strict';
import { SocksProxyAgent } from 'socks-proxy-agent';

const agent = new SocksProxyAgent('socks5h://proxy.example.com:1080', {
  timeout: 1000,
  socketOptions: {
    keepAlive: true,
  },
});

assert.equal(agent.timeout, 1000);
assert.deepEqual(agent.socketOptions, { keepAlive: true });
assert.equal(agent.proxy.type, 5);
assert.equal(agent.shouldLookup, false);
```

## Using the agent with Node HTTP clients

Pass the agent through the built-in HTTP client's `{ agent }` option. The documented HTTPS integration is:

```ts
import https from 'https';
import { SocksProxyAgent } from 'socks-proxy-agent';

const agent = new SocksProxyAgent(
  'socks://your-name%40gmail.com:abcdef12345124@br41.nordvpn.com'
);

https.get('https://ipinfo.io', { agent }, (res) => {
  console.log(res.headers);
  res.pipe(process.stdout);
});
```

That request requires a reachable SOCKS proxy and network access, so it is not used as a standalone validation example here.

The same agent can be supplied to the separately installed `ws` package for WebSocket connections:

```ts
import WebSocket from 'ws';
import { SocksProxyAgent } from 'socks-proxy-agent';

const agent = new SocksProxyAgent(
  'socks://your-name%40gmail.com:abcdef12345124@br41.nordvpn.com'
);

const socket = new WebSocket('ws://echo.websocket.events', { agent });
```

This integration also requires the separate `ws` package and a network connection.

## Common migration mistake

Do not use the v7-era single-object constructor. Older examples commonly show:

```ts
new SocksProxyAgent(
  {
    hostname: 'myproxy.mydomain.com',
    username: 'proxyUser',
    password: 'proxyPass',
  },
  { timeout: 1000 }
);
```

In v10, the first argument must be a `string` or `URL`; put proxy credentials and endpoint information in the SOCKS URI, and pass options as the second argument:

```ts
new SocksProxyAgent(
  'socks5://proxyUser:proxyPass@myproxy.mydomain.com:1080',
  { timeout: 1000 }
);
```

Also account for the v10 runtime requirements: Node.js must be 20 or newer, and the package is ESM.

## Not covered

This skill does not cover SOCKS server setup, proxy authentication behavior beyond URI encoding, detailed SOCKS protocol internals, custom socket connection behavior, the complete `http.AgentOptions` or `SocksSocketOptions` type surfaces, or testing live HTTP/WebSocket connections. The HTTP and WebSocket examples require network access and, for WebSockets, the separate `ws` dependency.

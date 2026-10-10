---
name: http-proxy-agent
description: Use http-proxy-agent 9.x to route Node HTTP requests through an HTTP or HTTPS proxy.
---

Verified against http-proxy-agent@9.1.0 on 2026-09-08. 3 of 3 examples executed.

# http-proxy-agent 9.x

## Runtime and module shape

- Version 9 is an ESM package and requires Node.js 20 or newer.
- Import the named `HttpProxyAgent` export:

```ts
import { HttpProxyAgent } from 'http-proxy-agent';
```

- Do not use CommonJS `require()` or assume a default export.
- The package implements an `http.Agent` for requests made through an HTTP or HTTPS proxy. For proxying via Node's `https` module, use `https-proxy-agent` instead.

## Constructing an agent

The constructor is:

```ts
new HttpProxyAgent(proxy, options?)
```

`proxy` must be a proxy URL string or a `URL` instance. In v6 and later, pass it as the first argument and pass agent options separately as the second argument.

```ts
import { HttpProxyAgent } from 'http-proxy-agent';

const agent = new HttpProxyAgent(
  'https://proxy.example.test:8443',
  { keepAlive: true }
);
```

The proxy URL controls the proxy connection. An HTTPS proxy uses a TLS socket; an HTTP proxy uses a regular TCP socket.

The options accept normal Node `http.Agent` options and an additional `headers` option. `headers` can be either an object or a function returning an object:

```ts
import { HttpProxyAgent } from 'http-proxy-agent';

const agent = new HttpProxyAgent('http://proxy.example.test:3128', {
  keepAlive: true,
  headers: () => ({
    'X-Proxy-Request': 'example'
  })
});
```

Proxy headers can also reach the destination if the proxy does not strip them.

## Inspecting the configured agent

The proxy URL is available as `agent.proxy`. Use its `protocol` to distinguish HTTP and HTTPS proxies; the old public `secureProxy` getter was removed in v7.

`agent.proxyHeaders` contains the configured header object or header-producing function. `agent.connectOpts` contains the connection options used for the proxy connection.

```ts pmcp-example
import assert from 'node:assert/strict';
import { HttpProxyAgent } from 'http-proxy-agent';

const headers = { 'X-Proxy-Request': 'example' };
const agent = new HttpProxyAgent('https://proxy.example.test:8443', {
  keepAlive: true,
  headers
});

assert.equal(agent.proxy.protocol, 'https:');
assert.equal(agent.proxy.hostname, 'proxy.example.test');
assert.equal(agent.proxy.port, '8443');
assert.deepEqual(agent.proxyHeaders, headers);
assert.equal(agent.connectOpts.host, 'proxy.example.test');
assert.equal(agent.connectOpts.port, 8443);
```

## Supported protocols

The class advertises both HTTP and HTTPS request protocols through its static `protocols` property:

```ts pmcp-example
import assert from 'node:assert/strict';
import { HttpProxyAgent } from 'http-proxy-agent';

assert.deepEqual(HttpProxyAgent.protocols, ['http', 'https']);

const agent = new HttpProxyAgent(new URL('http://proxy.example.test:3128'));
assert.equal(agent.proxy.href, 'http://proxy.example.test:3128/');
assert.equal(agent.proxy.protocol, 'http:');
```

`URL.href` includes a trailing slash when the URL has no path, so compare against the normalized value with `/`.

## Using the agent with Node HTTP

Pass the agent in the request options. The agent rewrites the request path to an absolute URL for the proxy, adds `Proxy-Authorization: Basic ...` when the proxy URL contains credentials, and uses `Proxy-Connection: Keep-Alive` when `keepAlive` is enabled; otherwise it defaults that header to `close`.

```ts
import * as http from 'http';
import { HttpProxyAgent } from 'http-proxy-agent';

const agent = new HttpProxyAgent('http://proxy.example.test:3128');

http.get('http://nodejs.org/api/', { agent }, (res) => {
  res.pipe(process.stdout);
});
```

This request requires a reachable proxy and destination. It is not suitable for an offline standalone example; exercise it in the application or integration environment that provides the proxy.

## Public agent methods

The class exposes `addRequest`, `setRequestProps`, and `connect`, in addition to inherited `http.Agent` behavior. `connect` opens the proxy socket and therefore requires a real request context and reachable proxy; `addRequest` and `setRequestProps` operate on Node client-request objects. Do not call these methods with arbitrary plain objects merely to test them.

```ts pmcp-example
import assert from 'node:assert/strict';
import { HttpProxyAgent } from 'http-proxy-agent';

const agent = new HttpProxyAgent('http://proxy.example.test:3128');

assert.equal(typeof agent.addRequest, 'function');
assert.equal(typeof agent.setRequestProps, 'function');
assert.equal(typeof agent.connect, 'function');
assert.equal(typeof agent.createConnection, 'function');
```

## Common version-migration mistakes

- **Using the v5 constructor shape:** v5 examples commonly pass one object shaped like deprecated `url.parse()` output, including `protocol`, `host`, `port`, `auth`, and `timeout`. Version 9 requires the proxy URL/string as argument one and options as argument two.
- **Passing old parsed-URL fields:** current examples use a URL string or `URL` instance. When representing proxy credentials in a `URL`-style object, current documented fields are `hostname`, `port`, `username`, and `password`, not the old `host` and `auth` combination.
- **Reading `secureProxy`:** that public getter was removed in v7. Check `agent.proxy.protocol === 'https:'` instead.
- **Running on an older Node version:** v9 requires Node.js 20 or newer.
- **Expecting an HTTPS-module agent:** this package is for HTTP requests through an HTTP/HTTPS proxy. Use `https-proxy-agent` when the request is made through Node's `https` module.

## Not covered

This skill does not cover proxy-server setup, authentication-server behavior, network troubleshooting, TLS certificate configuration, the full Node `http.Agent` API, or integration-test setup. The request flow and the `connect`/request methods require a real reachable proxy and are only described here, not exercised by the offline examples.

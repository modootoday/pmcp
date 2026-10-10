# Hosting a skill catalog

[Back to the overview](../README.md)

## Hosting over HTTP

`@modootoday/pmcp/http` serves the same tools and resources over streamable HTTP for a hosted
catalog. Tools, resources, the Skills extension and prompts all read the same per-caller,
tier-filtered catalog, so a file of a skill a caller cannot list cannot be read either. The
extension's `cacheScope` is `private` there by default (`cacheScope` overrides it), and
`prompts: true` turns prompts on.
The host owns identity: `authorize(request)` returns the caller or `undefined` (answered 401),
and `tiersFor(caller)` decides which tiers that caller sees (default `open` and `free`; skills
without a tier count as `open`). The catalog is read once; call `reload()` after deploying new
skill releases.

```ts
import { createSkillHttpHandler } from "@modootoday/pmcp/http";

const skills = createSkillHttpHandler({
  roots: [],
  marketplaces: ["/srv/marketplace", "/srv/marketplace-free"],
  authorize: async (request) =>
    verifyBearer(request.headers.get("authorization")),
});
export default { fetch: (request: Request) => skills.fetch(request) };
```

The handler checks requests before they reach MCP:

| Option            | Default | Effect                                                                                                                                                                                                                                  |
| ----------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allowedOrigins`  | none    | A request with an `Origin` other than the server's own gets 403. Listed origins are served with CORS headers, and their preflight is answered. `"*"` admits any origin. Requests without `Origin` are not from a browser page and pass. |
| `publicOrigins`   | none    | The server's own origins as browsers see them, when a proxy ends TLS and the request URL is `http://`. Without it, a same-site page behind such a proxy gets 403.                                                                       |
| `allowedHosts`    | any     | When set, a `Host` outside the list gets 403 (DNS rebinding).                                                                                                                                                                           |
| `maxRequestBytes` | 1 MiB   | A larger body gets 413; a declared length is refused before reading.                                                                                                                                                                    |
| `rateLimit`       | off     | `{ perMinute }` per caller id; past it, 429 with `retry-after`.                                                                                                                                                                         |

An MCP config (`.mcp.json`) is never served as written: every `env` and `headers` value is
replaced with `<redacted>`, whichever entry reaches the file, and listed digests describe
the redacted bytes.

Pass `semantic: { modelId: "embeddinggemma-2", cacheDir, localOnly: true }` to rank by meaning: the handler encodes
the catalog at start with `@huggingface/transformers` and the multilingual model, so an
intent in one language finds a description in another. Requests rank lexically until
`ready()` settles, and stay lexical when the encoder cannot load (`onError` says why).

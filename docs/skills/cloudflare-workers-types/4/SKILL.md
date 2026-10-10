---
name: cloudflare-workers-types
description: Type shared Cloudflare Workers libraries with workers-types 4.x, or diagnose Fetch handler, binding, and DOM type conflicts. For application binding generation, use the project's Wrangler types workflow.
compatibility: TypeScript 5.x with Cloudflare Workers types 4.x; type declarations do not provide a Worker runtime.
---

# Cloudflare Workers types 4.x

## Choose the application's types or a shared library's types

For a Worker application, generate types from its existing Wrangler configuration.
They describe bindings and the configured compatibility date and flags. Regenerate
after changing those inputs; do not repair generated declarations by hand.

For a shared library without a concrete deployment configuration,
`@cloudflare/workers-types` provides platform contracts. Version
`4.20260702.1` has semantic major **4**; its date-shaped minor is the package
release, not the application's `compatibility_date`.

Workers-types 5 removes dated entrypoints. Do not apply that migration to a
project pinned to 4.x or advance its runtime date to match a declaration package.

## Compile against the intended platform

Use an ES library without browser DOM globals and include the selected Workers
declarations. Combining `lib.dom` and Workers globals can introduce incompatible
`Request`, `Response`, and event declarations. Separate Node tooling and Worker
application TypeScript configurations when their execution environments differ.

```ts
interface Env {
  CACHE: KVNamespace;
  API: Fetcher;
}

export default {
  async fetch(request, env, ctx) {
    const cached = await env.CACHE.get("message");
    if (cached) return new Response(cached);
    const response = await env.API.fetch(request);
    ctx.waitUntil(Promise.resolve());
    return response;
  },
} satisfies ExportedHandler<Env>;
```

This shared-library contract does not provision `CACHE` or `API`. A consuming
application must configure real bindings and validate them with generated types.
Keep `Env` concrete: an unknown binding and an invalid KV payload should fail
compilation. `skipLibCheck` does not make an incorrect application contract valid.

## Keep type evidence separate from runtime evidence

The declaration package supplies no Worker execution environment. Compilation
cannot establish persistence, permissions, service connectivity, or compatibility
behavior. Verify those with the project's local Workers runner and selected
bindings; a successful Node Fetch request is not equivalent to executing workerd.

## Sources

- [Cloudflare TypeScript guidance](https://developers.cloudflare.com/workers/languages/typescript/)
- [Compatibility dates](https://developers.cloudflare.com/workers/configuration/compatibility-dates/)
- [Cloudflare's official Workers skill](https://github.com/cloudflare/skills/blob/0871daceb347e3c51693fbe9c77555468df7e410/skills/workers-best-practices/SKILL.md)

export interface FixtureEnv {
  CACHE: KVNamespace;
  API: Fetcher;
  MODE: "fixture";
}

export default {
  async fetch(request, env, ctx) {
    const cached = await env.CACHE.get("message");
    if (cached) return new Response(cached);
    const response = await env.API.fetch(request);
    ctx.waitUntil(Promise.resolve());
    return response;
  },
} satisfies ExportedHandler<FixtureEnv>;

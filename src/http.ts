// Keep identity and tier selection in the host so a transport cannot grant its own access.

import {
  createMcpHandler,
  type McpHttpHandler,
} from "@modelcontextprotocol/server";

import { readCatalog, type SkillEntry } from "./catalog.js";
import {
  encodeEntries,
  loadEmbedder,
  type LoadEmbedderOptions,
} from "./embed.js";
import type { Embedder } from "./find.js";
import {
  capBody,
  checkHost,
  checkOrigin,
  corsHeaders,
  createRateLimiter,
  DEFAULT_MAX_REQUEST_BYTES,
  preflight,
  withHeaders,
  type RateLimitOptions,
} from "./http-guard.js";
import { createSkillServer } from "./mcp.js";
import type { SkillServerOptions } from "./server.js";
import type { MailboxService } from "./mailbox/service.js";

export { DEFAULT_MODEL_ID, loadEmbedder } from "./embed.js";
export { readCatalog } from "./catalog.js";
export { verifiedRuntimesOf } from "./runtime.js";
export type { CatalogOptions, SkillEntry } from "./catalog.js";
export type { Runtime } from "./runtime.js";
export type { Embedder } from "./find.js";
export {
  DEFAULT_MAX_REQUEST_BYTES,
  type RateLimitOptions,
} from "./http-guard.js";

export interface SkillHttpSemanticOptions extends Omit<
  LoadEmbedderOptions,
  "module"
> {
  readonly modelId?: string;

  readonly embedder?: Embedder;

  readonly onError?: (error: unknown) => void;
}

export interface SkillCaller {
  readonly id: string;

  readonly claims?: Readonly<Record<string, unknown>>;
}

export interface SkillHttpOptions extends SkillServerOptions {
  readonly mailboxFor?: (
    caller: SkillCaller,
  ) => MailboxService | undefined | Promise<MailboxService | undefined>;

  readonly authorize: (
    request: Request,
  ) => SkillCaller | undefined | Promise<SkillCaller | undefined>;

  readonly tiersFor?: (caller: SkillCaller) => readonly string[];

  readonly challenge?: string;

  readonly semantic?: SkillHttpSemanticOptions;

  readonly prompts?: boolean;
  // Use private extension caching because the catalog may be filtered differently for each caller.
  readonly cacheScope?: "public" | "private";

  readonly allowedOrigins?: readonly string[];

  readonly publicOrigins?: readonly string[];

  readonly allowedHosts?: readonly string[];

  readonly maxRequestBytes?: number;

  readonly rateLimit?: RateLimitOptions;
}

export const DEFAULT_TIERS: readonly string[] = ["open", "free"];

export function visibleTo(
  entries: readonly SkillEntry[],
  tiers: readonly string[],
): SkillEntry[] {
  const allowed = new Set(tiers);
  return entries.filter((entry) => allowed.has(entry.tier ?? "open"));
}

export interface SkillHttpHandler {
  fetch(request: Request): Promise<Response>;

  reload(): void;

  ready(): Promise<"semantic" | "lexical">;
}

export function createSkillHttpHandler(
  options: SkillHttpOptions,
): SkillHttpHandler {
  const load = options.loadCatalog ?? readCatalog;
  let all = load(options);
  const tiersFor = options.tiersFor ?? (() => DEFAULT_TIERS);
  const handlers = new Map<string, McpHttpHandler>();

  // Wait for complete encoder coverage so a request never mixes incomparable ranking methods.
  let embedder: Embedder | undefined;
  let encoded = new Map<string, { hash: string; vector: Float32Array }>();
  let vectors: ReadonlyMap<string, Float32Array> | undefined;
  const semantic = options.semantic;

  const encode = async (): Promise<"semantic" | "lexical"> => {
    if (!semantic) return "lexical";
    try {
      embedder ??=
        semantic.embedder ??
        (await loadEmbedder(semantic.modelId, semantic)) ??
        undefined;
      if (!embedder)
        throw new Error("@huggingface/transformers is not installed");
      encoded = await encodeEntries(embedder, all, encoded);
      vectors = new Map([...encoded].map(([name, v]) => [name, v.vector]));
      return "semantic";
    } catch (error) {
      semantic.onError?.(error);
      return "lexical";
    }
  };
  let ready = encode();

  const handlerFor = (
    tiers: readonly string[],
    mailbox?: MailboxService,
  ): McpHttpHandler => {
    const key = JSON.stringify({
      tiers: [...tiers].sort(),
      mailbox: mailbox
        ? [
            mailbox.binding.projectId,
            mailbox.binding.actorId,
            mailbox.binding.sessionId,
            mailbox.binding.generation,
          ]
        : null,
    });
    const cached = handlers.get(key);
    if (cached) return cached;
    const handler = createMcpHandler(() =>
      createSkillServer({
        ...options,
        ...(mailbox ? { mailbox } : {}),
        ...(embedder && vectors ? { embedder, vectors } : {}),
        loadCatalog: () => visibleTo(all, tiers),
        skillsExtension: { cacheScope: options.cacheScope ?? "private" },
      }),
    );
    handlers.set(key, handler);
    return handler;
  };

  const limit = options.rateLimit
    ? createRateLimiter(options.rateLimit)
    : undefined;

  // Authorize before reading bodies so unauthenticated requests cannot consume the full body budget.
  const serve = async (request: Request): Promise<Response> => {
    const caller = await options.authorize(request);
    if (!caller) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: {
          "content-type": "application/json",
          "www-authenticate": options.challenge ?? "Bearer",
        },
      });
    }
    const limited = limit?.(caller.id);
    if (limited) return limited;
    const capped = await capBody(
      request,
      options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES,
    );
    if (capped instanceof Response) return capped;
    const mailbox = await options.mailboxFor?.(caller);
    return handlerFor(tiersFor(caller), mailbox).fetch(capped, {
      authInfo: {
        token: "",
        clientId: caller.id,
        scopes: [],
        extra: { ...caller.claims },
      },
    });
  };

  return {
    async fetch(request: Request): Promise<Response> {
      const wrongHost = checkHost(request, options.allowedHosts);
      if (wrongHost) return wrongHost;
      const origin = checkOrigin(
        request,
        options.allowedOrigins,
        options.publicOrigins,
      );
      if (origin.kind === "refused") return origin.response;
      if (origin.kind !== "allowed") return serve(request);
      if (request.method === "OPTIONS") return preflight(origin.origin);
      return withHeaders(await serve(request), corsHeaders(origin.origin));
    },
    reload(): void {
      all = load(options);
      handlers.clear();
      vectors = undefined;
      ready = encode();
    },
    ready: () => ready,
  };
}

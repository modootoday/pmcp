/**
 * The catalog over streamable HTTP, for a hosted skills server.
 *
 * The host owns identity: it passes authorize(), which turns a request into a
 * caller or undefined. Anonymous requests are refused; each caller sees only the
 * tiers tiersFor() grants. The catalog is read once and filtered per request.
 */

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
export type { Embedder } from "./find.js";
export {
  DEFAULT_MAX_REQUEST_BYTES,
  type RateLimitOptions,
} from "./http-guard.js";

/** Semantic ranking for a hosted catalog: the encoder runs in the host process. */
export interface SkillHttpSemanticOptions extends Omit<
  LoadEmbedderOptions,
  "module"
> {
  /** Defaults to the multilingual model pmcp index uses. */
  readonly modelId?: string;
  /** Injected for tests, or by a host that already holds an encoder. */
  readonly embedder?: Embedder;
  /** Told when the encoder cannot load; ranking then stays lexical. */
  readonly onError?: (error: unknown) => void;
}

export interface SkillCaller {
  /** Stable id of the signed-in user, recorded by the host, never by pmcp. */
  readonly id: string;
  /** Whatever the host's token carried; passed to tiersFor unchanged. */
  readonly claims?: Readonly<Record<string, unknown>>;
}

export interface SkillHttpOptions extends SkillServerOptions {
  readonly mailboxFor?: (
    caller: SkillCaller,
  ) => MailboxService | undefined | Promise<MailboxService | undefined>;
  /** Gets the Request the host's fetch received; read headers only, the body is still unread. */
  readonly authorize: (
    request: Request,
  ) => SkillCaller | undefined | Promise<SkillCaller | undefined>;
  /** Tiers a caller may list and load. Package skills without a tier count as open. */
  readonly tiersFor?: (caller: SkillCaller) => readonly string[];
  /** Sent in WWW-Authenticate on a refused request, e.g. a resource metadata URL. */
  readonly challenge?: string;
  /** Encode the catalog at start so find ranks by meaning across languages. */
  readonly semantic?: SkillHttpSemanticOptions;
  /** One prompt per skill. Off by default: the list grows with the catalog. */
  readonly prompts?: boolean;
  /**
   * Cache scope the Skills extension declares. The catalog is filtered per caller
   * here, so "private" unless the host knows every caller sees the same list.
   */
  readonly cacheScope?: "public" | "private";
  /** Browser origins, besides the server's own, whose pages may call; others get 403. "*" admits any. */
  readonly allowedOrigins?: readonly string[];
  /** The server's own public origins when a proxy ends TLS, e.g. "https://skills.example.com". */
  readonly publicOrigins?: readonly string[];
  /** Host header values the server answers to; unset means any. */
  readonly allowedHosts?: readonly string[];
  /** Largest request body accepted; larger ones get 413. */
  readonly maxRequestBytes?: number;
  /** Per-caller request ceiling; unset means the host limits rate itself. */
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
  /** Re-read the catalog, for a host that deploys new skill releases in place. */
  reload(): void;
  /** Settles once the catalog is encoded, or at once when ranking is lexical. */
  ready(): Promise<"semantic" | "lexical">;
}

export function createSkillHttpHandler(
  options: SkillHttpOptions,
): SkillHttpHandler {
  const load = options.loadCatalog ?? readCatalog;
  let all = load(options);
  const tiersFor = options.tiersFor ?? (() => DEFAULT_TIERS);
  const handlers = new Map<string, McpHttpHandler>();

  // Requests rank lexically until the encoder and every vector are in place;
  // find already refuses a partial index, so no request sees a mixed ranking.
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

  // authorize sees the host's own Request object (hosts key callers by it) before
  // any body is read, so an unauthenticated caller never makes the server read up to the cap.
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

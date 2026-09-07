import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { DEFAULT_INTENT_CACHE_LIMIT, openIntentCache } from "../src/cache.js";
import { normaliseIntent } from "../src/intent.js";

const dir = mkdtempSync(join(tmpdir(), "pmcp-cache-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const vec = (...values: number[]) => new Float32Array(values);

describe("normaliseIntent", () => {
  it("folds case, punctuation and spacing into one key", () => {
    expect(normaliseIntent("How do I wire X?")).toBe(
      normaliseIntent("how  do i wire x"),
    );
  });

  it("keeps different questions apart", () => {
    expect(normaliseIntent("wire the runner")).not.toBe(
      normaliseIntent("wire the parser"),
    );
  });

  it("keeps digits, which carry meaning in a version or a count", () => {
    expect(normaliseIntent("upgrade to v2")).toBe("upgrade to v2");
  });

  it("keeps non-latin letters rather than dropping them", () => {
    expect(normaliseIntent("日本語 запрос ελληνικά")).toBe(
      "日本語 запрос ελληνικά",
    );
  });

  it("returns an empty key for punctuation alone", () => {
    expect(normaliseIntent("???")).toBe("");
  });
});

describe("openIntentCache", () => {
  const open = async (over: Record<string, unknown> = {}) =>
    (await openIntentCache({
      path: ":memory:",
      modelId: "m1",
      dims: 3,
      ...over,
    }))!;

  it("misses on an empty cache", async () => {
    const cache = await open();
    expect(cache.get("anything")).toBeNull();
    expect(cache.stats().misses).toBe(1);
    expect(cache.stats().hits).toBe(0);
    cache.close();
  });

  it("round-trips a vector", async () => {
    const cache = await open();
    cache.put("wire the runner", vec(0.1, 0.2, 0.3));
    const back = cache.get("wire the runner");
    expect(back).not.toBeNull();
    expect(Array.from(back!)).toEqual([
      Math.fround(0.1),
      Math.fround(0.2),
      Math.fround(0.3),
    ]);
    cache.close();
  });

  it("hits on the same question typed differently", async () => {
    const cache = await open();
    cache.put("Wire the runner!", vec(1, 2, 3));
    expect(cache.get("wire  the RUNNER")).not.toBeNull();
    expect(cache.stats().hits).toBe(1);
    cache.close();
  });

  // Two models' distances are not comparable. Shared file, not two :memory:
  // handles: those share nothing and the assertion would hold for a cache that
  // ignored model_id entirely.
  it("does not return a row written by a different model", async () => {
    const path = join(dir, "model.sqlite");
    const first = (await openIntentCache({ path, modelId: "m1", dims: 3 }))!;
    first.put("q", vec(1, 2, 3));
    first.close();

    const second = (await openIntentCache({ path, modelId: "m2", dims: 3 }))!;
    expect(second.get("q")).toBeNull();
    expect(second.stats().mismatched).toBe(1);
    expect(second.stats().hits).toBe(0);
    second.close();
  });

  // Left in place rather than deleted: a rollback makes it current again.
  it("keeps the other model's row so a rollback can use it", async () => {
    const path = join(dir, "rollback.sqlite");
    const m1 = (await openIntentCache({ path, modelId: "m1", dims: 3 }))!;
    m1.put("q", vec(1, 2, 3));
    m1.close();

    const m2 = (await openIntentCache({ path, modelId: "m2", dims: 3 }))!;
    m2.get("q");
    m2.close();

    const back = (await openIntentCache({ path, modelId: "m1", dims: 3 }))!;
    expect(Array.from(back.get("q")!)).toEqual([1, 2, 3]);
    back.close();
  });

  it("counts a width mismatch as mismatched rather than a hit", async () => {
    const path = join(dir, "width.sqlite");
    const wide = (await openIntentCache({ path, modelId: "m1", dims: 3 }))!;
    wide.put("q", vec(1, 2, 3));
    wide.close();

    const narrow = (await openIntentCache({ path, modelId: "m1", dims: 2 }))!;
    expect(narrow.get("q")).toBeNull();
    expect(narrow.stats().mismatched).toBe(1);
    narrow.close();
  });

  it("refuses to store a vector of the wrong width", async () => {
    const cache = await open();
    expect(() => cache.put("q", vec(1, 2))).toThrow(
      "intent vector is 2 wide, cache holds 3",
    );
    cache.close();
  });

  // The reason this is a table rather than a Map: an MCP server exits with the
  // session, and the next session must not pay for the same question again.
  it("survives closing and reopening the database", async () => {
    const path = join(dir, "persist.sqlite");
    const first = (await openIntentCache({ path, modelId: "m1", dims: 3 }))!;
    first.put("remembered", vec(7, 8, 9));
    first.close();

    const second = (await openIntentCache({ path, modelId: "m1", dims: 3 }))!;
    expect(Array.from(second.get("remembered")!)).toEqual([7, 8, 9]);
    expect(second.stats().hits).toBe(1);
    second.close();
  });

  it("overwrites rather than duplicating on a repeated put", async () => {
    const cache = await open();
    cache.put("q", vec(1, 1, 1));
    cache.put("q", vec(2, 2, 2));
    expect(cache.stats().rows).toBe(1);
    expect(Array.from(cache.get("q")!)).toEqual([2, 2, 2]);
    cache.close();
  });

  it("evicts the least recently asked once past the limit", async () => {
    let clock = 0;
    const cache = await open({ limit: 2, now: () => (clock += 1) });
    cache.put("first", vec(1, 0, 0));
    cache.put("second", vec(0, 1, 0));
    cache.get("first"); // first is now the more recent of the two
    cache.put("third", vec(0, 0, 1));

    expect(cache.stats().rows).toBe(2);
    expect(cache.get("second")).toBeNull();
    expect(cache.get("first")).not.toBeNull();
    expect(cache.get("third")).not.toBeNull();
    cache.close();
  });

  // A cache that throws turns a missing optimisation into a failed search.
  // The same null answers "this runtime has neither builtin", which is why
  // opening is async and why it is tried rather than assumed.
  it("returns null rather than throwing when the path cannot be opened", async () => {
    expect(
      await openIntentCache({
        path: join(dir, "no", "such", "dir", "c.sqlite"),
        modelId: "m1",
        dims: 3,
      }),
    ).toBeNull();
  });

  it("exposes its default limit rather than hiding it", () => {
    expect(DEFAULT_INTENT_CACHE_LIMIT).toBeGreaterThan(0);
  });

  // The server is wired to run under node, so this is the binary that has to
  // have a working cache. A single-runtime import would have made it null here
  // and nobody would have noticed until they looked at the hit count.
  it("uses the builtin the running binary has", async () => {
    const cache = await open();
    expect(cache.stats().provider).toBe("node:sqlite");
    cache.close();
  });
});

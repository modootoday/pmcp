import type { Embedder } from "../find.js";
export async function encodeEntries(
  embedder: Embedder,
  entries: readonly {
    readonly name: string;
    readonly description: string;
  }[],
  previous: ReadonlyMap<
    string,
    {
      hash: string;
      vector: Float32Array;
    }
  > = new Map(),
): Promise<
  Map<
    string,
    {
      hash: string;
      vector: Float32Array;
    }
  >
> {
  const out = new Map<
    string,
    {
      hash: string;
      vector: Float32Array;
    }
  >();
  const passage = (text: string) =>
    embedder.embedPassage ? embedder.embedPassage(text) : embedder.embed(text);
  for (const entry of entries) {
    const hash = describeHash(entry.description);
    const kept = previous.get(entry.name);
    if (kept && kept.hash === hash) {
      out.set(entry.name, kept);
      continue;
    }
    out.set(entry.name, { hash, vector: await passage(entry.description) });
  }
  return out;
}
export function describeHash(description: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < description.length; i++) {
    hash ^= description.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

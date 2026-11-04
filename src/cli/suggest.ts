// Did-you-mean for commands, subcommands and flags; plain edit distance, no dependency.

export function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(above + 1, row[j - 1]! + 1, diagonal + cost);
      diagonal = above;
    }
  }
  return row[b.length]!;
}

// Short words get one edit, longer ones two, so "ls" never suggests "mcp".
export function closest(
  word: string,
  candidates: readonly string[],
): string | undefined {
  const limit = word.length <= 3 ? 1 : 2;
  let best: string | undefined;
  let bestDistance = limit + 1;
  for (const candidate of candidates) {
    const d = distance(word, candidate);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  if (best !== undefined) return best;
  return candidates.find(
    (candidate) => word.length >= 3 && candidate.startsWith(word),
  );
}

export function didYouMean(
  word: string,
  candidates: readonly string[],
  format: (candidate: string) => string = (candidate) => `"${candidate}"`,
): string {
  const match = closest(word, candidates);
  return match === undefined ? "" : `; did you mean ${format(match)}?`;
}

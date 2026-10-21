import { blockOutput, type Output } from "./outputs.js";

export function mergeBlocks(outputs: readonly Output[]): Output[] {
  const contents = new Map<string, string[]>();
  for (const output of outputs) {
    if (output.kind !== "block") continue;
    contents.set(output.file, [
      ...(contents.get(output.file) ?? []),
      output.content,
    ]);
  }
  const merged: Output[] = [];
  const done = new Set<string>();
  for (const output of outputs) {
    if (output.kind !== "block") {
      merged.push(output);
      continue;
    }
    if (done.has(output.file)) continue;
    done.add(output.file);
    const parts = contents.get(output.file) ?? [];
    if (parts.length === 1) {
      merged.push(output);
      continue;
    }
    const content = `${parts.map((part) => part.trimEnd()).join("\n\n")}\n`;
    merged.push(blockOutput(output.file, content));
  }
  return merged;
}

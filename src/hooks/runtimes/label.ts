// A fixed, short name per event: Codex lists it in /hooks (else "Unnamed hook") and Claude and
// grok show it while the hook runs. It is part of the projected entry, so it must not vary.
export function hookLabel(event: string): string {
  return `pmcp ${event.replaceAll("_", " ")}`;
}

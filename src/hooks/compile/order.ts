// Policy identifiers are ASCII, so locale initialization only adds startup cost.
export function compareIdentifiers(left: string, right: string): number {
  if (left < right) return -1;
  return Number(left > right);
}

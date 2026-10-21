// Sharing the rejection helper avoids a result/error union that Vitest accepts but TypeScript rejects.
export async function refusalMessage(
  promise: Promise<unknown>,
): Promise<string> {
  try {
    await promise;
  } catch (reason) {
    return reason instanceof Error ? reason.message : String(reason);
  }
  throw new Error("expected the call to be refused");
}

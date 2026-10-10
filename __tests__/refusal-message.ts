/**
 * The message from a call that must reject. Written once because the inline
 * form types as the union of the result and the error, which vitest never
 * notices and tsc always does.
 */
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

// A walk yields between units of work, so the same walk serves a blocking read and a read that
// lets a server answer other requests while the catalog is still being built.
export type Steps<T> = Generator<void, T, void>;

export function runSteps<T>(steps: Steps<T>): T {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

export async function runStepsYielding<T>(steps: Steps<T>): Promise<T> {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

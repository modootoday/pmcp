export async function step(name, operation, timeout = 15000) {
  let timer;
  const startedAt = Date.now();
  process.stderr.write(`Vite fixture starting ${name}\n`);
  const expired = new Promise((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(`Vite fixture timed out during ${name} after ${timeout}ms`),
        ),
      timeout,
    );
  });
  try {
    const result = await Promise.race([operation(), expired]);
    process.stderr.write(
      `Vite fixture completed ${name} in ${Date.now() - startedAt}ms\n`,
    );
    return result;
  } finally {
    clearTimeout(timer);
  }
}

export async function cleanupSteps(operations, primaryError) {
  const errors = [];
  for (const { name, operation } of operations) {
    try {
      await step(name, operation);
    } catch (error) {
      errors.push(error);
      process.stderr.write(`Vite fixture cleanup failure: ${error.message}\n`);
    }
  }
  if (errors.length && !primaryError) {
    throw new AggregateError(errors, "Vite fixture cleanup failed");
  }
}

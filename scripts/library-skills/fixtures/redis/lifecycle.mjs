export async function bounded(promise, label, milliseconds = 10_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out: ${label}`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function deferred() {
  let resolve;
  const promise = new Promise((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

export async function closeRedis(client) {
  if (!client || client.status === "end") return;
  try {
    await bounded(client.quit(), "Redis quit", 2000);
  } finally {
    client.disconnect();
  }
}

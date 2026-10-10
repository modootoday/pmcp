export async function nodeRows(result) {
  const rows = [];
  for await (const chunk of result.stream()) {
    for (const row of chunk) rows.push(row.json());
  }
  return rows;
}

export async function webRows(result) {
  const reader = result.stream().getReader();
  const rows = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return rows;
      for (const row of value) rows.push(row.json());
    }
  } finally {
    reader.releaseLock();
  }
}

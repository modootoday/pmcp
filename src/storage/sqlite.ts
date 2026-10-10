export interface SqliteStatement<Row> {
  get(...params: unknown[]): Row | undefined | null;
  all(...params: unknown[]): Row[];
  run(...params: unknown[]): unknown;
}

export interface SqliteHandle {
  exec(sql: string): unknown;
  prepare<Row = unknown>(sql: string): SqliteStatement<Row>;
  close(): void;
}

export type SqliteProvider = "node:sqlite" | "bun:sqlite";

export async function openSqlite(
  path: string,
  options: { readOnly?: boolean } = {},
): Promise<{ db: SqliteHandle; provider: SqliteProvider }> {
  const provider: SqliteProvider = process.versions.bun
    ? "bun:sqlite"
    : "node:sqlite";
  const sqlite = await import(provider);
  if (provider === "node:sqlite") {
    const { DatabaseSync } = sqlite as {
      DatabaseSync: new (
        path: string,
        options: { readOnly?: boolean },
      ) => SqliteHandle;
    };
    return { db: new DatabaseSync(path, options), provider };
  }
  const { Database } = sqlite as {
    Database: new (
      path: string,
      options: { create: boolean; readonly?: boolean },
    ) => {
      run(sql: string): unknown;
      query<Row>(sql: string): SqliteStatement<Row>;
      close(): void;
    };
  };
  const native = new Database(path, {
    create: !options.readOnly,
    readonly: options.readOnly,
  });
  return {
    provider,
    db: {
      exec: (sql) => native.run(sql),
      prepare: <Row>(sql: string) => native.query<Row>(sql),
      close: () => native.close(),
    },
  };
}

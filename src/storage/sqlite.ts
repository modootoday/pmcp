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
  if (!process.versions.bun) {
    const name = "node:sqlite";
    const { DatabaseSync } = (await import(name)) as {
      DatabaseSync: new (
        path: string,
        options: { readOnly?: boolean },
      ) => SqliteHandle;
    };
    return { db: new DatabaseSync(path, options), provider: name };
  }
  const name = "bun:sqlite";
  const { Database } = (await import(name)) as {
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
    provider: name,
    db: {
      exec: (sql) => native.run(sql),
      prepare: <Row>(sql: string) => native.query<Row>(sql),
      close: () => native.close(),
    },
  };
}

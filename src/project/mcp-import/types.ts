export type Table = Record<string, unknown>;
export interface McpImportEntry {
  readonly alias: string;
  readonly status: "add" | "unchanged" | "conflict" | "blocked";
  readonly source: string;
  readonly detail?: string;
}
export interface McpImportPlan {
  readonly entries: readonly McpImportEntry[];
  readonly additions: Readonly<Record<string, Table>>;
  readonly original: string;
  readonly config: string;
  readonly sources: readonly {
    path: string;
    sha256: string;
  }[];
}

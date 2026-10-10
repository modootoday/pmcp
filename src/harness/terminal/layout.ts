export interface LayoutPane {
  readonly role: "main" | "dock" | "coordination";
  readonly x: number;
  readonly y: number;
  readonly columns: number;
  readonly rows: number;
}

export interface TerminalLayout {
  readonly schemaVersion: 1;
  readonly mode: "a" | "compact";
  readonly columns: number;
  readonly rows: number;
  readonly statusRows: 1;
  readonly panes: readonly LayoutPane[];
  readonly workerView: "separate-window";
}

export function planLayout(columns: number, rows: number): TerminalLayout {
  if (!Number.isSafeInteger(columns) || columns < 40 || columns > 1000) {
    throw new RangeError("columns must be an integer between 40 and 1000");
  }
  if (!Number.isSafeInteger(rows) || rows < 12 || rows > 1000) {
    throw new RangeError("rows must be an integer between 12 and 1000");
  }
  const contentRows = rows - 1;
  if (columns < 120 || rows < 32) {
    return {
      schemaVersion: 1,
      mode: "compact",
      columns,
      rows,
      statusRows: 1,
      panes: [{ role: "main", x: 0, y: 0, columns, rows: contentRows }],
      workerView: "separate-window",
    };
  }
  const dockColumns = Math.min(40, Math.max(28, Math.floor(columns / 4)));
  const mainColumns = columns - dockColumns - 1;
  const nativeRows = contentRows - 5;
  return {
    schemaVersion: 1,
    mode: "a",
    columns,
    rows,
    statusRows: 1,
    panes: [
      { role: "main", x: 0, y: 0, columns: mainColumns, rows: nativeRows },
      {
        role: "dock",
        x: mainColumns + 1,
        y: 0,
        columns: dockColumns,
        rows: nativeRows,
      },
      { role: "coordination", x: 0, y: nativeRows + 1, columns, rows: 4 },
    ],
    workerView: "separate-window",
  };
}

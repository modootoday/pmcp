// Keep terminal formatting local so server installation does not require a UI library.

export interface Stream {
  write(text: string): unknown;
  isTTY?: boolean;
}

export interface UiOptions {
  readonly stdout?: Stream;
  readonly stderr?: Stream;

  readonly color?: boolean;

  readonly quiet?: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

// Construct escapes from character codes to keep raw control bytes out of source.
const ESC = String.fromCharCode(27);

const CODES = {
  reset: `${ESC}[0m`,
  bold: `${ESC}[1m`,
  dim: `${ESC}[2m`,
  red: `${ESC}[31m`,
  green: `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  cyan: `${ESC}[36m`,
} as const;

export type Colour = keyof typeof CODES;

// Use ASCII symbols because unsupported glyphs can hide terminal status.
const SYMBOL = {
  success: "+",
  error: "x",
  warn: "!",
  info: "-",
  prompt: ">",
} as const;

export type Kind = keyof typeof SYMBOL;

const KIND_COLOUR: Record<Kind, Colour> = {
  success: "green",
  error: "red",
  warn: "yellow",
  info: "cyan",
  prompt: "cyan",
};

export class Ui {
  private readonly out: Stream;
  private readonly err: Stream;
  private readonly quiet: boolean;
  readonly colour: boolean;

  constructor(options: UiOptions = {}) {
    this.out = options.stdout ?? process.stdout;
    this.err = options.stderr ?? process.stderr;
    this.quiet = options.quiet ?? false;
    const env = options.env ?? process.env;
    this.colour =
      options.color ??
      (this.err.isTTY === true &&
        (env["NO_COLOR"] ?? "") === "" &&
        env["TERM"] !== "dumb");
  }

  paint(text: string, ...colours: readonly Colour[]): string {
    if (!this.colour || colours.length === 0) return text;
    return `${colours.map((c) => CODES[c]).join("")}${text}${CODES.reset}`;
  }

  // Separate diagnostics so redirected data stays machine-readable.
  data(text: string): void {
    this.out.write(text);
  }

  line(text = ""): void {
    if (this.quiet) return;
    this.err.write(`${text}\n`);
  }

  message(kind: Kind, text: string, detail?: string): void {
    const mark = this.paint(SYMBOL[kind], KIND_COLOUR[kind], "bold");
    const tail = detail === undefined ? "" : ` ${this.paint(detail, "dim")}`;
    // Keep errors visible under quiet mode so failed operations remain observable.
    if (kind === "error" && this.quiet) {
      this.err.write(`${mark} ${text}${tail}\n`);
      return;
    }
    this.line(`${mark} ${text}${tail}`);
  }

  success(text: string, detail?: string): void {
    this.message("success", text, detail);
  }

  error(text: string, detail?: string): void {
    this.message("error", text, detail);
  }

  warn(text: string, detail?: string): void {
    this.message("warn", text, detail);
  }

  info(text: string, detail?: string): void {
    this.message("info", text, detail);
  }

  table(rows: ReadonlyArray<readonly [string, string]>, indent = "  "): void {
    const width = rows.reduce((n, [left]) => Math.max(n, left.length), 0);
    for (const [left, right] of rows) {
      this.line(
        `${indent}${this.paint(left.padEnd(width), "cyan")}  ${this.paint(right, "dim")}`,
      );
    }
  }

  heading(text: string): void {
    this.line(this.paint(text, "bold"));
  }
}

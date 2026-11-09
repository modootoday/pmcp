// Keep terminal formatting local so server installation does not require a UI library.

export interface Stream {
  write(text: string): unknown;
  isTTY?: boolean;
  columns?: number;
}

const HELP_WIDTH = 80;
const MIN_DESCRIBE = 20;

export function clampWidth(columns: number): number {
  return Math.min(120, Math.max(40, columns));
}

// Greedy word wrap; a word longer than the line stays whole rather than being cut.
export function wrap(
  text: string,
  width: number | undefined,
  indent: number,
): string[] {
  if (width === undefined) return [text];
  const room = Math.max(1, width - indent);
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/ +/u)) {
    if (current === "") current = word;
    else if (current.length + 1 + word.length <= room) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

// One status record on a terminal of this width: wrapped under a hanging indent, and a word
// wider than the room cut with the ellipsis, so no line runs past the edge.
export function fitRecord(
  record: string,
  width: number,
  ellipsis = "…",
): string[] {
  const line = record.replaceAll("\t", "  ");
  if (line.length <= width) return [line];
  const lead = line.length - line.trimStart().length;
  const hang = Math.min(lead + 4, Math.floor(width / 2));
  const room = width - hang;
  return wrap(line.trimStart(), room, 0).map((part, at) => {
    const cut =
      part.length <= room
        ? part
        : `${part.slice(0, Math.max(0, room - ellipsis.length))}${ellipsis}`;
    return `${" ".repeat(at === 0 ? lead : hang)}${cut}`;
  });
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

type Env = Readonly<Record<string, string | undefined>>;

const ASCII: Readonly<Record<string, string>> = {
  "·": "/",
  "…": "...",
  "✗": "x",
};

// FORCE_COLOR wins over the TTY test as Node does; 0 or false turns colour off.
export function colourFrom(env: Env, tty: boolean): boolean {
  const force = env["FORCE_COLOR"];
  if (force !== undefined && force !== "") {
    return force !== "0" && force !== "false";
  }
  return tty && (env["NO_COLOR"] ?? "") === "" && env["TERM"] !== "dumb";
}

export function asciiOnly(env: Env): boolean {
  if (env["TERM"] === "dumb") return true;
  const locale = env["LC_ALL"] || env["LC_CTYPE"] || env["LANG"] || "";
  return locale !== "" && !/utf-?8/iu.test(locale);
}

export class Ui {
  private readonly out: Stream;
  private readonly err: Stream;
  private readonly quiet: boolean;
  private readonly options: UiOptions;
  private view: Ui | undefined;
  private captured: string[] | undefined;
  private noted: string[] | undefined;
  readonly colour: boolean;
  readonly ascii: boolean;

  constructor(options: UiOptions = {}) {
    this.options = options;
    this.out = options.stdout ?? process.stdout;
    this.err = options.stderr ?? process.stderr;
    this.quiet = options.quiet ?? false;
    const env = options.env ?? process.env;
    this.colour = options.color ?? colourFrom(env, this.err.isTTY === true);
    this.ascii = asciiOnly(env);
  }

  // The same formatting aimed at stdout and never silenced: a command's result, which
  // -q must not erase and a pipe must receive. Diagnostics stay on this Ui (stderr).
  get results(): Ui {
    const stdout: Stream = {
      write: (text) => this.data(text),
      isTTY: this.out.isTTY === true,
      ...(this.out.columns ? { columns: this.out.columns } : {}),
    };
    this.view ??= new Ui({
      ...this.options,
      stdout,
      stderr: stdout,
      quiet: false,
    });
    return this.view;
  }

  paint(text: string, ...colours: readonly Colour[]): string {
    if (!this.colour || colours.length === 0) return text;
    return `${colours.map((c) => CODES[c]).join("")}${text}${CODES.reset}`;
  }

  // Separate diagnostics so redirected data stays machine-readable.
  data(text: string): void {
    if (this.captured) {
      this.captured.push(text);
      return;
    }
    this.out.write(text);
  }

  // Under --json the command's stdout is held and its errors noted, so one envelope
  // can carry both; release() hands them back and writes again go straight out.
  capture(): void {
    this.captured = [];
    this.noted = [];
  }

  release(): { printed: string; errors: string[] } {
    const result = {
      printed: (this.captured ?? []).join(""),
      errors: this.noted ?? [],
    };
    this.captured = undefined;
    this.noted = undefined;
    return result;
  }

  line(text = ""): void {
    if (this.quiet) return;
    this.err.write(`${this.text(text)}\n`);
  }

  // Replace the few typographic characters pmcp prints when the terminal cannot show them.
  text(value: string): string {
    if (!this.ascii) return value;
    return value.replace(/[—–·…✗]/gu, (char) => ASCII[char] ?? "-");
  }

  // k of N on one rewritten line on a TTY; elsewhere a plain line every tenth, so logs stay readable.
  progress(total: number, label: string): (done: number) => void {
    const step = Math.max(1, Math.ceil(total / 10));
    const tty = this.err.isTTY === true;
    return (done) => {
      if (this.quiet || total === 0) return;
      const text = `  ${done}/${total} ${label}`;
      if (tty) {
        this.err.write(`\r${text}${ESC}[K${done === total ? "\n" : ""}`);
        return;
      }
      if (done === total || done % step === 0) this.err.write(`${text}\n`);
    };
  }

  message(kind: Kind, text: string, detail?: string): void {
    const mark = this.paint(SYMBOL[kind], KIND_COLOUR[kind], "bold");
    const tail = detail === undefined ? "" : ` ${this.paint(detail, "dim")}`;
    if (kind === "error" && this.noted) {
      this.noted.push(detail === undefined ? text : `${text}: ${detail}`);
    }
    // Keep errors visible under quiet mode so failed operations remain observable.
    if (kind === "error" && this.quiet) {
      this.err.write(this.text(`${mark} ${text}${tail}\n`));
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

  // Help wraps at the terminal width, or 80 off a terminal; a table off a terminal is
  // one plain record per line so grep and cut see whole records.
  width(kind: "help" | "table"): number | undefined {
    const env = this.options.env ?? process.env;
    const columns = Number.parseInt(env["COLUMNS"] ?? "", 10);
    if (Number.isFinite(columns) && columns > 0) return clampWidth(columns);
    if (this.err.isTTY === true) return clampWidth(this.err.columns || 80);
    return kind === "help" ? HELP_WIDTH : undefined;
  }

  // A paragraph wrapped to the width, continuation lines under the first word.
  wrapped(text: string, indent = "  ", ...colours: readonly Colour[]): void {
    for (const line of wrap(text, this.width("help"), indent.length))
      this.line(`${indent}${this.paint(line, ...colours)}`);
  }

  table(
    rows: ReadonlyArray<readonly [string, string]>,
    indent = "  ",
    width = this.width("table"),
  ): void {
    if (width === undefined) {
      for (const [left, right] of rows)
        this.line(
          `${indent}${this.paint(left, "cyan")}  ${this.paint(right, "dim")}`,
        );
      return;
    }
    const longest = rows.reduce((n, [left]) => Math.max(n, left.length), 0);
    const column = Math.min(longest, Math.floor(width * 0.4));
    const room = width - indent.length - column - 2;
    for (const [left, right] of rows) {
      // A name wider than its column, or no room beside it, stacks the description below.
      if (left.length > column || room < MIN_DESCRIBE) {
        this.line(`${indent}${this.paint(left, "cyan")}`);
        for (const line of wrap(right, width, indent.length + 4))
          this.line(`${indent}    ${this.paint(line, "dim")}`);
        continue;
      }
      const lines = wrap(right, room, 0);
      const pad = " ".repeat(indent.length + column + 2);
      this.line(
        `${indent}${this.paint(left.padEnd(column), "cyan")}  ${this.paint(lines[0] ?? "", "dim")}`,
      );
      for (const line of lines.slice(1))
        this.line(`${pad}${this.paint(line, "dim")}`);
    }
  }

  // Status records on stdout: fitted to a terminal's width, one whole line each elsewhere so
  // grep and cut see whole records.
  records(lines: readonly string[]): void {
    const width = this.out.isTTY === true ? this.width("table") : undefined;
    const ellipsis = this.ascii ? "..." : "…";
    for (const record of lines) {
      const line = this.text(record);
      const parts =
        width === undefined ? [line] : fitRecord(line, width, ellipsis);
      this.data(`${parts.join("\n")}\n`);
    }
  }

  heading(text: string): void {
    this.wrapped(text, "", "bold");
  }
}

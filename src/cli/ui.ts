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
    this.view ??= new Ui({
      ...this.options,
      stdout: this.out,
      stderr: this.out,
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
    this.out.write(text);
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

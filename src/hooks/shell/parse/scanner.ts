// Split shell source into words, operators and redirections, with quotes and substitutions read
// the way the shell reads them.

import type { List, Param, Redirect, Word } from "./ast.js";

export class ShellSyntaxError extends Error {
  constructor(
    message: string,
    readonly at: number,
  ) {
    super(`${message} at offset ${at}`);
  }
}

// How the scanner reads the list inside $( ... ), <( ... ) and backticks.
export interface Nested {
  // The list starting at pos, and the index just past its closing ")".
  at(text: string, pos: number): { list: List; end: number };
  // What a backtick body runs.
  whole(text: string): List;
}

export type Token =
  | {
      readonly kind: "word";
      readonly word: Word;
      readonly raw: string;
      readonly start: number;
    }
  | { readonly kind: "op"; readonly op: string; readonly start: number }
  | {
      readonly kind: "redirect";
      readonly op: string;
      readonly fd: string;
      readonly start: number;
    }
  | { readonly kind: "eof"; readonly start: number };

const OPERATORS = [
  ";;&",
  "&&",
  "||",
  ";;",
  ";&",
  "|&",
  ";",
  "&",
  "|",
  "(",
  ")",
  "\n",
];
const REDIRECTS = [
  "&>>",
  "<<<",
  "<<-",
  "&>",
  ">>",
  ">|",
  "<>",
  "<<",
  ">&",
  "<&",
  ">",
  "<",
];
const BREAKS = new Set([" ", "\t", "\n", ";", "&", "|", "<", ">", "(", ")"]);
const TEST_OPERATORS = ["&&", "||", "(", ")", "<", ">"];
const ARRAY_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\+?=$/u;
const PARAM = /\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\})/uy;

// Where a word's parameter expansions are recorded, and the word's length before this part.
interface ParamSink {
  readonly params: Param[];
  readonly base: number;
}
const ANSI_ESCAPES: Readonly<Record<string, string>> = {
  n: "\n",
  t: "\t",
  r: "\r",
  a: "\u0007",
  b: "\b",
  e: "\u001b",
  E: "\u001b",
  f: "\f",
  v: "\v",
};

interface PendingHeredoc {
  readonly redirect: Redirect;
  readonly delimiter: string;
  readonly strip: boolean;
  readonly quoted: boolean;
}

export class Scanner {
  private pending: PendingHeredoc[] = [];

  constructor(
    readonly text: string,
    public pos: number,
    private readonly nested: Nested,
  ) {}

  token(): Token {
    this.blank();
    const { text } = this;
    const start = this.pos;
    if (start >= text.length) return { kind: "eof", start };
    if (text[start] === "\n") {
      this.pos += 1;
      this.heredocs();
      return { kind: "op", op: "\n", start };
    }
    if (!text.startsWith("<(", start) && !text.startsWith(">(", start)) {
      const fd = /^\d+(?=[<>])/u.exec(text.slice(start, start + 12))?.[0] ?? "";
      const at = start + fd.length;
      const redirect = REDIRECTS.find((op) => text.startsWith(op, at));
      if (redirect) {
        this.pos = at + redirect.length;
        return { kind: "redirect", op: redirect, fd, start };
      }
      const op = OPERATORS.find((candidate) =>
        text.startsWith(candidate, start),
      );
      if (op) {
        this.pos += op.length;
        return { kind: "op", op, start };
      }
    }
    const word = this.word();
    if (this.pos === start)
      throw new ShellSyntaxError(`unexpected ${text[start]}`, start);
    return { kind: "word", word, raw: text.slice(start, this.pos), start };
  }

  // A word inside [[ ]], where < > ( ) && || belong to the test; null at the closing ]].
  testWord(regex: boolean): { word: Word; raw: string } | null {
    const { text } = this;
    while (
      " \t\n".includes(text[this.pos] ?? "x") ||
      text.startsWith("\\\n", this.pos)
    )
      this.pos += text[this.pos] === "\\" ? 2 : 1;
    const start = this.pos;
    if (start >= text.length) throw new ShellSyntaxError("unclosed [[", start);
    if (text.startsWith("]]", start) && this.ends(start + 2)) {
      this.pos += 2;
      return null;
    }
    const op = TEST_OPERATORS.find((candidate) =>
      text.startsWith(candidate, start),
    );
    if (op && !regex) {
      this.pos += op.length;
      return { word: { text: op, nested: [], params: [] }, raw: op };
    }
    const word = this.word(regex);
    if (this.pos === start)
      throw new ShellSyntaxError(`unexpected ${text[start]}`, start);
    return { word, raw: text.slice(start, this.pos) };
  }

  // The (( ... )) starting at pos as one word, or null when the parentheses close as a subshell.
  arithmetic(pos: number): Word | null {
    const nested: List[] = [];
    const end = this.arithmeticEnd(pos, nested);
    if (end < 0) return null;
    this.pos = end;
    return { text: this.text.slice(pos + 2, end - 2), nested, params: [] };
  }

  heredoc(
    redirect: Redirect,
    delimiter: Word,
    raw: string,
    strip: boolean,
  ): void {
    this.pending.push({
      redirect,
      delimiter: delimiter.text,
      strip,
      quoted: /['"\\]/u.test(raw),
    });
  }

  private ends(at: number): boolean {
    const char = this.text[at];
    return char === undefined || BREAKS.has(char);
  }

  private blank(): void {
    const { text } = this;
    for (;;) {
      const char = text[this.pos];
      if (char === " " || char === "\t") this.pos += 1;
      else if (text.startsWith("\\\n", this.pos)) this.pos += 2;
      else if (char === "#") {
        const end = text.indexOf("\n", this.pos);
        this.pos = end < 0 ? text.length : end;
      } else return;
    }
  }

  private word(regex = false): Word {
    const { text } = this;
    const start = this.pos;
    const nested: List[] = [];
    const params: Param[] = [];
    let out = "";
    let depth = 0;
    while (this.pos < text.length) {
      const char = text[this.pos]!;
      const next = text[this.pos + 1];
      if ((char === "<" || char === ">") && next === "(") {
        const inner = this.nested.at(text, this.pos + 2);
        nested.push(inner.list);
        this.pos = inner.end;
        out += "$()";
        continue;
      }
      if (
        char === "(" &&
        !regex &&
        ARRAY_ASSIGNMENT.test(text.slice(start, this.pos))
      ) {
        out += this.array(nested);
        continue;
      }
      if (regex && char === "(") depth += 1;
      if (regex && char === ")" && depth > 0) depth -= 1;
      const inRegex =
        regex && ("()|".includes(char) || (depth > 0 && char === " "));
      if (BREAKS.has(char) && !inRegex) break;
      if (char === "\\") {
        if (next !== "\n") out += next ?? "";
        this.pos += 2;
        continue;
      }
      if (char === "'") {
        const end = text.indexOf("'", this.pos + 1);
        if (end < 0) throw new ShellSyntaxError("unclosed '", this.pos);
        out += text.slice(this.pos + 1, end);
        this.pos = end + 1;
        continue;
      }
      if (char === "$" && next === "'") {
        out += this.ansi();
        continue;
      }
      if (char === "$" && next === '"') {
        this.pos += 1;
        continue;
      }
      if (char === '"') {
        this.pos += 1;
        out += this.quoted('"', nested, { params, base: out.length });
        continue;
      }
      const expansion = this.expansion(nested, { params, base: out.length });
      if (expansion !== null) {
        out += expansion;
        continue;
      }
      out += char;
      this.pos += 1;
    }
    return { text: out, nested, params };
  }

  // Double-quoted text up to close, or to the end for a here-document body (close null).
  private quoted(
    close: string | null,
    nested: List[],
    sink?: ParamSink,
  ): string {
    const { text } = this;
    let out = "";
    while (this.pos < text.length) {
      const char = text[this.pos]!;
      if (char === close) {
        this.pos += 1;
        return out;
      }
      if (char === "\\") {
        const next = text[this.pos + 1] ?? "";
        if (next !== "\n") out += '$`"\\'.includes(next) ? next : `\\${next}`;
        this.pos += 2;
        continue;
      }
      const expansion = this.expansion(
        nested,
        sink && { params: sink.params, base: sink.base + out.length },
      );
      if (expansion !== null) {
        out += expansion;
        continue;
      }
      out += char;
      this.pos += 1;
    }
    if (close !== null)
      throw new ShellSyntaxError(`unclosed ${close}`, this.pos);
    return out;
  }

  private expansion(nested: List[], sink?: ParamSink): string | null {
    const { text } = this;
    const at = this.pos;
    PARAM.lastIndex = at;
    const param = PARAM.exec(text);
    if (param) {
      this.pos = PARAM.lastIndex;
      sink?.params.push({
        name: (param[1] ?? param[2])!,
        start: sink.base,
        end: sink.base + param[0].length,
      });
      return param[0];
    }
    if (text.startsWith("$((", at)) {
      const end = this.arithmeticEnd(at + 1, nested);
      if (end >= 0) {
        this.pos = end;
        return text.slice(at, end);
      }
    }
    if (text.startsWith("$(", at)) {
      const inner = this.nested.at(text, at + 2);
      nested.push(inner.list);
      this.pos = inner.end;
      return "$()";
    }
    if (text.startsWith("${", at)) {
      this.pos = this.braceEnd(at + 2, nested);
      return text.slice(at, this.pos);
    }
    if (text[at] === "`") {
      nested.push(this.backtick());
      return "$()";
    }
    return null;
  }

  // Index just past the )) closing the (( at open, or -1 when a lone ) closes it first.
  private arithmeticEnd(open: number, nested: List[]): number {
    const { text } = this;
    const found: List[] = [];
    let depth = 0;
    let index = open + 2;
    while (index < text.length) {
      const char = text[index]!;
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (text.startsWith("$(", index) && !text.startsWith("$((", index)) {
        const inner = this.nested.at(text, index + 2);
        found.push(inner.list);
        index = inner.end;
        continue;
      }
      if (char === "(") depth += 1;
      if (char === ")") {
        if (depth === 0) {
          if (text[index + 1] !== ")") return -1;
          nested.push(...found);
          return index + 2;
        }
        depth -= 1;
      }
      index += 1;
    }
    return -1;
  }

  // Index just past the } closing a ${ whose body starts at from.
  private braceEnd(from: number, nested: List[]): number {
    const { text } = this;
    let depth = 1;
    this.pos = from;
    while (this.pos < text.length) {
      const char = text[this.pos]!;
      if (char === "\\") {
        this.pos += 2;
        continue;
      }
      if (char === "'") {
        const end = text.indexOf("'", this.pos + 1);
        if (end < 0) throw new ShellSyntaxError("unclosed '", this.pos);
        this.pos = end + 1;
        continue;
      }
      if (char === '"') {
        this.pos += 1;
        this.quoted('"', nested);
        continue;
      }
      if (text.startsWith("${", this.pos)) {
        depth += 1;
        this.pos += 2;
        continue;
      }
      if (char === "}") {
        depth -= 1;
        this.pos += 1;
        if (depth === 0) return this.pos;
        continue;
      }
      if (this.expansion(nested) === null) this.pos += 1;
    }
    throw new ShellSyntaxError("unclosed ${", from);
  }

  private backtick(): List {
    const { text } = this;
    let inner = "";
    let index = this.pos + 1;
    while (index < text.length && text[index] !== "`") {
      const next = text[index + 1] ?? "";
      if (text[index] === "\\" && "$`\\".includes(next)) {
        inner += next;
        index += 2;
        continue;
      }
      inner += text[index];
      index += 1;
    }
    if (index >= text.length)
      throw new ShellSyntaxError("unclosed `", this.pos);
    this.pos = index + 1;
    return this.nested.whole(inner);
  }

  private ansi(): string {
    const { text } = this;
    let out = "";
    let index = this.pos + 2;
    while (index < text.length && text[index] !== "'") {
      if (text[index] === "\\") {
        const next = text[index + 1] ?? "";
        out += ANSI_ESCAPES[next] ?? next;
        index += 2;
        continue;
      }
      out += text[index];
      index += 1;
    }
    if (index >= text.length)
      throw new ShellSyntaxError("unclosed $'", this.pos);
    this.pos = index + 1;
    return out;
  }

  // The (...) of name=(...), its elements as words.
  private array(nested: List[]): string {
    const { text } = this;
    const elements: string[] = [];
    this.pos += 1;
    for (;;) {
      while (" \t\n".includes(text[this.pos] ?? "x")) this.pos += 1;
      if (text[this.pos] === "#") this.blank();
      if (this.pos >= text.length)
        throw new ShellSyntaxError("unclosed (", this.pos);
      if (text[this.pos] === ")") {
        this.pos += 1;
        return `(${elements.join(" ")})`;
      }
      const start = this.pos;
      const element = this.word();
      if (this.pos === start)
        throw new ShellSyntaxError(`unexpected ${text[start]}`, start);
      nested.push(...element.nested);
      elements.push(element.text);
    }
  }

  private heredocs(): void {
    const { text } = this;
    const pending = this.pending;
    this.pending = [];
    for (const doc of pending) {
      let body = "";
      while (this.pos < text.length) {
        const end = text.indexOf("\n", this.pos);
        const stop = end < 0 ? text.length : end;
        const line = text.slice(this.pos, stop);
        this.pos = end < 0 ? stop : end + 1;
        if ((doc.strip ? line.replace(/^\t+/u, "") : line) === doc.delimiter)
          break;
        body += `${line}\n`;
      }
      doc.redirect.body = doc.quoted
        ? { text: body, nested: [], params: [] }
        : this.expanded(body);
    }
  }

  private expanded(body: string): Word {
    const scanner = new Scanner(body, 0, this.nested);
    const nested: List[] = [];
    return { text: scanner.quoted(null, nested), nested, params: [] };
  }
}

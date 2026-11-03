// Recursive-descent parser for the shell grammar: lists, && and ||, pipelines, subshells, groups,
// compound commands, function definitions and redirections.

import type { Command, Item, List, Pipeline, Redirect, Word } from "./ast.js";
import {
  type Nested,
  Scanner,
  ShellSyntaxError,
  type Token,
} from "./scanner.js";

export { ShellSyntaxError } from "./scanner.js";

const LIST_END_OPERATORS = new Set([")", ";;", ";&", ";;&"]);
const CASE_ENDS = new Set([";;", ";&", ";;&"]);
const NO_KEYWORDS: ReadonlySet<string> = new Set();
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\+?=/u;
const ARRAY = /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\+?=\(/u;
// Builtins whose name=(...) arguments the shell reads as array assignments.
const DECLARES = new Set(["declare", "local", "export", "readonly", "typeset"]);
// Reserved words that only continue a construct; one that opens a command is a syntax error.
const CONTINUATIONS = new Set([
  "then",
  "elif",
  "else",
  "fi",
  "do",
  "done",
  "esac",
  "}",
  // ! negates a whole pipeline, so it cannot follow a |.
  "!",
]);

const NESTED: Nested = {
  at(text, pos) {
    const parser = new Parser(text, pos);
    const list = parser.list(NO_KEYWORDS);
    parser.op(")");
    return { list, end: parser.position() };
  },
  whole: runnable,
};

// The shell parses a backtick body only when it runs it, a line at a time: the complete lines
// before one it cannot parse still run, and nothing from that line on does.
function runnable(text: string): List {
  try {
    return parseScript(text);
  } catch (error) {
    if (!(error instanceof ShellSyntaxError)) throw error;
    const line = lineStart(text, error.at);
    return line === 0 ? [] : runnable(text.slice(0, line));
  }
}

// Start of the line holding the character before at; a backslash-newline joins two lines into one.
function lineStart(text: string, at: number): number {
  let newline = text.lastIndexOf("\n", Math.min(at, text.length - 1) - 1);
  while (newline >= 0 && continued(text, newline)) {
    newline = text.lastIndexOf("\n", newline - 1);
  }
  return newline + 1;
}

function continued(text: string, newline: number): boolean {
  let slashes = 0;
  while (text[newline - 1 - slashes] === "\\") slashes += 1;
  return slashes % 2 === 1;
}

// Throws ShellSyntaxError where the shell itself would refuse the script.
export function parseScript(text: string): List {
  const parser = new Parser(text, 0);
  const list = parser.list(NO_KEYWORDS);
  parser.end();
  return list;
}

function describe(token: Token): string {
  if (token.kind === "eof") return "end of input";
  if (token.kind === "word") return token.raw;
  return token.op === "\n" ? "newline" : token.op;
}

class Parser {
  private readonly scan: Scanner;
  private ahead: Token | undefined;

  constructor(text: string, pos: number) {
    this.scan = new Scanner(text, pos, NESTED);
  }

  position(): number {
    return this.scan.pos;
  }

  end(): void {
    const token = this.peek();
    if (token.kind !== "eof") this.fail(token);
  }

  op(op: string): void {
    const token = this.next();
    if (token.kind !== "op" || token.op !== op) this.fail(token, op);
  }

  // Items until a token that closes the enclosing construct: ), ;;, the end, or a keyword in ends.
  list(ends: ReadonlySet<string>): List {
    const items: Item[] = [];
    for (;;) {
      this.newlines();
      const token = this.peek();
      if (token.kind === "eof") return items;
      if (token.kind === "op" && LIST_END_OPERATORS.has(token.op)) return items;
      if (token.kind === "word" && ends.has(token.raw)) return items;
      const { pipelines, operators } = this.andOr();
      const after = this.peek();
      const separator =
        after.kind === "op" && [";", "&", "\n"].includes(after.op)
          ? after.op
          : "";
      items.push({ pipelines, operators, background: separator === "&" });
      if (!separator) return items;
      this.next();
    }
  }

  private peek(): Token {
    this.ahead ??= this.scan.token();
    return this.ahead;
  }

  private next(): Token {
    const token = this.peek();
    this.ahead = undefined;
    return token;
  }

  private fail(token: Token, expected?: string): never {
    const found = describe(token);
    throw new ShellSyntaxError(
      expected ? `expected ${expected}, found ${found}` : `unexpected ${found}`,
      token.start,
    );
  }

  private isWord(token: Token, raw: string): boolean {
    return token.kind === "word" && token.raw === raw;
  }

  private keyword(raw: string): void {
    const token = this.next();
    if (!this.isWord(token, raw)) this.fail(token, raw);
  }

  private word(): { word: Word; raw: string } {
    const token = this.next();
    if (token.kind !== "word") this.fail(token, "a word");
    return { word: token.word, raw: token.raw };
  }

  private newlines(): void {
    for (;;) {
      const token = this.peek();
      if (token.kind !== "op" || token.op !== "\n") return;
      this.next();
    }
  }

  private andOr(): { pipelines: Pipeline[]; operators: string[] } {
    const pipelines = [this.pipeline()];
    const operators: string[] = [];
    for (;;) {
      const token = this.peek();
      if (token.kind !== "op" || (token.op !== "&&" && token.op !== "||"))
        return { pipelines, operators };
      this.next();
      operators.push(token.op);
      this.newlines();
      pipelines.push(this.pipeline());
    }
  }

  private pipeline(): Pipeline {
    let negated = false;
    let prefixed = false;
    for (;;) {
      const token = this.peek();
      if (this.isWord(token, "time")) {
        this.next();
        if (this.isWord(this.peek(), "-p")) this.next();
      } else if (this.isWord(token, "!")) {
        this.next();
        negated = !negated;
      } else break;
      prefixed = true;
    }
    // time and ! may end a line alone, timing or negating an empty pipeline.
    const next = this.peek();
    const ends =
      next.kind === "eof" ||
      (next.kind === "op" && (next.op === ";" || next.op === "\n"));
    if (prefixed && ends) return { negated, commands: [] };
    const commands = [this.command()];
    for (;;) {
      const token = this.peek();
      if (token.kind !== "op" || (token.op !== "|" && token.op !== "|&"))
        return { negated, commands };
      this.next();
      this.newlines();
      commands.push(this.command());
    }
  }

  private command(): Command {
    const token = this.peek();
    if (token.kind === "op" && token.op === "(")
      return this.parenthesized(token);
    if (token.kind !== "word") return this.simple();
    switch (token.raw) {
      case "{": {
        this.next();
        const body = this.filled(new Set(["}"]));
        this.keyword("}");
        return { kind: "group", body, redirects: this.redirects() };
      }
      case "if":
        return this.ifCommand();
      case "while":
      case "until":
        return this.loop(token.raw);
      case "for":
      case "select":
        return this.forCommand(token.raw);
      case "case":
        return this.caseCommand();
      case "[[":
        return this.test();
      case "function":
        return this.functionKeyword();
      default:
        if (CONTINUATIONS.has(token.raw)) this.fail(token);
        return this.simple();
    }
  }

  private parenthesized(token: Token): Command {
    this.ahead = undefined;
    if (this.scan.text[token.start + 1] === "(") {
      const word = this.scan.arithmetic(token.start);
      if (word)
        return this.closed({
          kind: "compound",
          keyword: "((",
          parts: [],
          words: [word],
          redirects: this.redirects(),
        });
      this.scan.pos = token.start + 1;
    }
    const body = this.filled(NO_KEYWORDS);
    this.op(")");
    return { kind: "subshell", body, redirects: this.redirects() };
  }

  // The list of a construct the shell refuses to leave empty.
  private filled(ends: ReadonlySet<string>): List {
    const list = this.list(ends);
    if (list.length === 0) this.fail(this.peek());
    return list;
  }

  private ifCommand(): Command {
    const parts: List[] = [];
    this.keyword("if");
    for (;;) {
      parts.push(this.filled(new Set(["then"])));
      this.keyword("then");
      parts.push(this.filled(new Set(["elif", "else", "fi"])));
      const token = this.next();
      if (this.isWord(token, "elif")) continue;
      if (this.isWord(token, "else")) {
        parts.push(this.filled(new Set(["fi"])));
        this.keyword("fi");
      } else if (!this.isWord(token, "fi")) this.fail(token, "fi");
      return this.compound("if", parts, []);
    }
  }

  private loop(keyword: string): Command {
    this.next();
    const condition = this.filled(new Set(["do"]));
    return this.compound(keyword, [condition, this.doBody()], []);
  }

  private doBody(): List {
    this.newlines();
    this.keyword("do");
    const body = this.filled(new Set(["done"]));
    this.keyword("done");
    return body;
  }

  private forCommand(keyword: string): Command {
    const start = this.next();
    const words: Word[] = [];
    let variable: string | undefined;
    const token = this.peek();
    if (
      token.kind === "op" &&
      token.op === "(" &&
      this.scan.text[token.start + 1] === "("
    ) {
      this.ahead = undefined;
      const header = this.scan.arithmetic(token.start);
      if (!header) this.fail(start, "((");
      words.push(header);
    } else {
      variable = this.word().raw;
      this.newlines();
      if (this.isWord(this.peek(), "in")) {
        this.next();
        for (;;) {
          const item = this.peek();
          if (item.kind !== "word") break;
          words.push(this.word().word);
        }
      }
    }
    const separator = this.peek();
    if (
      separator.kind === "op" &&
      (separator.op === ";" || separator.op === "\n")
    )
      this.next();
    return this.compound(keyword, [this.doBody()], words, variable);
  }

  private caseCommand(): Command {
    this.next();
    const words = [this.word().word];
    this.newlines();
    this.keyword("in");
    const parts: List[] = [];
    for (;;) {
      this.newlines();
      if (this.isWord(this.peek(), "esac")) {
        this.next();
        return this.compound("case", parts, words);
      }
      const open = this.peek();
      if (open.kind === "op" && open.op === "(") this.next();
      words.push(this.word().word);
      for (;;) {
        const token = this.next();
        if (token.kind === "op" && token.op === ")") break;
        if (token.kind !== "op" || token.op !== "|") this.fail(token, ")");
        words.push(this.word().word);
      }
      parts.push(this.list(new Set(["esac"])));
      const end = this.peek();
      if (end.kind === "op" && CASE_ENDS.has(end.op)) this.next();
      else if (!this.isWord(end, "esac")) this.fail(end, ";;");
    }
  }

  private test(): Command {
    this.next();
    const words: Word[] = [];
    let previous = "";
    for (;;) {
      const item = this.scan.testWord(previous === "=~");
      if (!item) return this.closed(this.compound("[[", [], words));
      words.push(item.word);
      previous = item.raw;
    }
  }

  // The shell reads (( )) and [[ ]] like a simple command, so a word right after one is no
  // reserved word: "{ (( n )) }" leaves the brace group open.
  private closed(command: Command): Command {
    const token = this.peek();
    if (token.kind === "word") this.fail(token);
    return command;
  }

  private functionKeyword(): Command {
    this.next();
    const { raw } = this.word();
    const token = this.peek();
    // function g (( ... )) has an arithmetic body, not the optional () after the name.
    if (
      token.kind === "op" &&
      token.op === "(" &&
      this.scan.text[token.start + 1] !== "("
    ) {
      this.next();
      this.op(")");
    }
    return { kind: "function", name: raw, body: this.functionBody() };
  }

  // A function body is a compound command: { }, ( ), if, while, until, for, case, [[ ]] or (( )).
  private functionBody(): Command {
    this.newlines();
    const start = this.peek();
    const body = this.command();
    if (body.kind === "simple" || body.kind === "function") this.fail(start);
    return body;
  }

  private compound(
    keyword: string,
    parts: List[],
    words: Word[],
    variable?: string,
  ): Command {
    return {
      kind: "compound",
      keyword,
      ...(variable ? { variable } : {}),
      parts,
      words,
      redirects: this.redirects(),
    };
  }

  private redirects(): Redirect[] {
    const redirects: Redirect[] = [];
    while (this.peek().kind === "redirect") redirects.push(this.redirect());
    return redirects;
  }

  private redirect(): Redirect {
    const token = this.next();
    if (token.kind !== "redirect") this.fail(token, "a redirection");
    const { word, raw } = this.word();
    const redirect: Redirect = {
      op: token.op,
      fd: token.fd,
      target: word,
      body: undefined,
    };
    if (token.op === "<<" || token.op === "<<-")
      this.scan.heredoc(redirect, word, raw, token.op === "<<-");
    return redirect;
  }

  private simple(): Command {
    const assigns: Word[] = [];
    const words: Word[] = [];
    const redirects: Redirect[] = [];
    let first = "";
    let redirectedAfterAssign = false;
    for (;;) {
      const token = this.peek();
      if (token.kind === "redirect") {
        redirects.push(this.redirect());
        if (assigns.length > 0) redirectedAfterAssign = true;
        continue;
      }
      if (token.kind !== "word") break;
      this.next();
      if (words.length === 0 && ASSIGNMENT.test(token.raw)) {
        // bash stops reading array assignments once a redirection follows an assignment.
        if (redirectedAfterAssign && ARRAY.test(token.raw)) this.fail(token);
        assigns.push(token.word);
        continue;
      }
      // name=(...) is an array only where an assignment may stand.
      if (ARRAY.test(token.raw) && !DECLARES.has(first)) this.fail(token);
      if (words.length === 0) first = token.raw;
      words.push(token.word);
      const after = this.peek();
      if (
        words.length === 1 &&
        assigns.length === 0 &&
        redirects.length === 0 &&
        after.kind === "op" &&
        after.op === "("
      ) {
        this.next();
        this.op(")");
        return { kind: "function", name: token.raw, body: this.functionBody() };
      }
    }
    if (assigns.length + words.length + redirects.length === 0)
      this.fail(this.peek());
    return { kind: "simple", assigns, words, redirects };
  }
}

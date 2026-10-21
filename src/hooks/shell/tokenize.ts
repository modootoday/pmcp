// Keep quoted words intact so shell syntax is not inferred from literal message text.

export const SEPARATORS: ReadonlySet<string> = new Set([
  "&&",
  "||",
  ";",
  "|",
  "&",
  "\n",
  "(",
  ")",
  "{",
  "}",
]);

export interface Tokens {
  readonly tokens: string[];
  readonly nested: string[];
}

// End of a double-quoted span starting after its opening quote, skipping escapes and the
// substitutions inside it, whose own quotes may contain a double quote.
function quoteEnd(text: string, start: number): number {
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") index += 1;
    else if (char === '"') return index;
    else if (text.startsWith("$(", index)) {
      const close = closing(text, index + 2);
      if (close < 0) return -1;
      index = close;
    } else if (char === "`") {
      const close = text.indexOf("`", index + 1);
      if (close < 0) return -1;
      index = close;
    }
  }
  return -1;
}

// The ")" closing a "$(" body. Parentheses inside quotes, backticks or after a backslash are
// literal, so grep -n "f(" inside $( ... ) no longer ends the substitution early.
function closing(text: string, start: number): number {
  let depth = 1;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    let skipTo = index;
    if (char === "\\") skipTo = index + 1;
    if (char === "'") skipTo = text.indexOf("'", index + 1);
    if (char === "`") skipTo = text.indexOf("`", index + 1);
    if (char === '"') skipTo = quoteEnd(text, index + 1);
    if (skipTo < 0) return -1;
    if (skipTo !== index) {
      index = skipTo;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

export function tokenize(script: string): Tokens | null {
  const tokens: string[] = [];
  const nested: string[] = [];
  let word = "";
  let started = false;
  const flush = () => {
    if (started) tokens.push(word);
    word = "";
    started = false;
  };
  for (let index = 0; index < script.length; index += 1) {
    const char = script[index]!;
    const pair = script.slice(index, index + 2);
    if (char === "'") {
      const end = script.indexOf("'", index + 1);
      if (end < 0) return null;
      word += script.slice(index + 1, end);
      started = true;
      index = end;
      continue;
    }
    if (char === '"' || char === "`") {
      let end = index + 1;
      let text = "";
      while (end < script.length && script[end] !== char) {
        if (script[end] === "\\" && char === '"') {
          text += script[end + 1] ?? "";
          end += 2;
          continue;
        }
        if (char === '"' && script.startsWith("$(", end)) {
          const close = closing(script, end + 2);
          if (close < 0) return null;
          nested.push(script.slice(end + 2, close));
          end = close + 1;
          continue;
        }
        if (char === '"' && script[end] === "`") {
          const close = script.indexOf("`", end + 1);
          if (close < 0) return null;
          nested.push(script.slice(end + 1, close));
          end = close + 1;
          continue;
        }
        text += script[end];
        end += 1;
      }
      if (end >= script.length) return null;
      if (char === "`") nested.push(text);
      if (char === '"') word += text;
      started = true;
      index = end;
      continue;
    }
    if (pair === "$(") {
      const close = closing(script, index + 2);
      if (close < 0) return null;
      nested.push(script.slice(index + 2, close));
      word += "$()";
      started = true;
      index = close;
      continue;
    }
    if (char === "\\") {
      word += script[index + 1] ?? "";
      started = true;
      index += 1;
      continue;
    }
    if (char === "#" && !started) {
      const end = script.indexOf("\n", index);
      index = end < 0 ? script.length : end - 1;
      continue;
    }
    if (pair === "&&" || pair === "||") {
      flush();
      tokens.push(pair);
      index += 1;
      continue;
    }
    if (SEPARATORS.has(char)) {
      flush();
      tokens.push(char);
      continue;
    }
    if (char === " " || char === "\t") {
      flush();
      continue;
    }
    word += char;
    started = true;
  }
  flush();
  return { tokens, nested };
}

---
name: wrap-ansi
description: Use wrap-ansi v10 to wrap plain or ANSI-styled strings by terminal column width.
---

Verified against wrap-ansi@10.0.1 on 2026-09-08. 6 of 6 examples executed.

# wrap-ansi

`wrap-ansi` v10 is a small ESM package with one runtime export: the default `wrapAnsi` function. It requires Node.js 20 or newer.

```ts
import wrapAnsi from 'wrap-ansi';

wrapAnsi(string: string, columns: number, options?: {
  readonly hard?: boolean;
  readonly wordWrap?: boolean;
  readonly trim?: boolean;
}): string;
```

The package is directly callable from a plain ESM script. It has no CLI or runner API. Use a default import:

```ts
import wrapAnsi from 'wrap-ansi';
```

Do not use the older CommonJS-style `require()` shape, and do not expect named runtime exports.

## Basic word wrapping

By default, `wordWrap` is enabled, `hard` is disabled, and surrounding whitespace is trimmed. Words are kept together when possible, so a long word may exceed the requested width unless hard wrapping is enabled.

```ts pmcp-example
import assert from 'node:assert/strict';
import wrapAnsi from 'wrap-ansi';

const result = wrapAnsi('one two three four', 10);

assert.equal(result, 'one two\nthree four');
```

## Hard wrapping long words

Set `hard: true` to prevent long words from extending past the column width.

```ts pmcp-example
import assert from 'node:assert/strict';
import wrapAnsi from 'wrap-ansi';

const result = wrapAnsi('Averylongword', 5, {hard: true});

assert.equal(result, 'Avery\nlongw\nord');
```

In v10, hard wrapping is subject to `wordWrap !== false`. If both options are supplied, disabling word wrapping changes the behavior; do not assume the v9 condition where `hard: true` always controlled splitting.

## Disabling word wrapping

Set `wordWrap: false` when the content should be filled to the column width and split without preserving word boundaries.

```ts pmcp-example
import assert from 'node:assert/strict';
import wrapAnsi from 'wrap-ansi';

const result = wrapAnsi('abcdef', 3, {wordWrap: false});

assert.equal(result, 'abc\ndef');
```

## Whitespace trimming

`trim` defaults to `true`. Set `trim: false` to preserve whitespace on all lines.

```ts pmcp-example
import assert from 'node:assert/strict';
import wrapAnsi from 'wrap-ansi';

assert.equal(wrapAnsi('  hi  ', 10), 'hi');
assert.equal(wrapAnsi('  hi  ', 10, {trim: false}), '  hi  ');
```

## Newlines and tabs

Newlines are normalized to `\n`. Tabs are expanded before wrapping, using 8-column tab stops. Account for the expanded spaces when choosing `columns`.

```ts pmcp-example
import assert from 'node:assert/strict';
import wrapAnsi from 'wrap-ansi';

assert.equal(wrapAnsi('first\r\nsecond', 20), 'first\nsecond');
assert.equal(wrapAnsi('a\tb', 9), 'a       b');
```

## ANSI-styled strings

The function measures visible terminal width rather than counting ANSI escape sequences as printable columns. It preserves the escape sequences in the result.

```ts pmcp-example
import assert from 'node:assert/strict';
import wrapAnsi from 'wrap-ansi';

const red = '\u001B[31mred\u001B[39m';

assert.equal(wrapAnsi(red, 3), red);
```

Version 10 tracks ANSI style families, including foreground, background, underline color, and modifier closing codes. It also recognizes CSI escapes and OSC-8 hyperlinks terminated by BEL or `ESC \\`.

## Version and compatibility notes

- v10 requires Node.js `>=20`; v9 required Node.js `>=18`.
- v10 uses `Intl.Segmenter` grapheme segmentation. Do not copy assumptions from older implementations that treated every JavaScript code point as a complete display unit.
- The v9 API is deceptively similar: it also uses an ESM default export and the same three option names. Code copied from v9 may miss v10's tab expansion and its changed interaction between `hard` and `wordWrap`.
- The package is not a command-line tool. A plain script can call the default function directly; there is no package command that needs to be launched for these examples.

## Not covered

This skill does not specify every edge case in terminal-width calculation, all ANSI control-sequence forms, hyperlink rendering behavior, invalid column values, or integration with Chalk or another color library. It also does not cover CommonJS interoperability, because v10's documented/exported surface is ESM.

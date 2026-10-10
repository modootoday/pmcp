---
name: string-width
description: Use string-width ^8.0.0 to calculate the terminal column width of strings, including Unicode, emoji, ANSI escape codes, ambiguous-width characters, tabs, and non-printing grapheme clusters.
---

Verified against string-width@8.2.2 on 2026-09-08. 4 of 4 examples executed.

# string-width

## Runtime and module shape

- This is an ESM package and requires Node.js `>=20`.
- Import the default export:

```ts
import stringWidth from 'string-width';
```

- The v8 API is `stringWidth(string, options?)` and returns a number.
- Do not use the older/common `require('string-width')` shape. v8 exposes a default ESM export.
- This package is a standalone function: it does not require a test runner, CLI, framework globals, or a build step.

## Basic width calculation

The result is the number of terminal columns needed to display the string.

- Ordinary characters generally count as one column.
- Fullwidth characters such as `古` count as two columns.
- ANSI escape codes do not affect the result by default.
- Tabs are ignored by design rather than expanded to a tab-stop width.
- Non-printing grapheme clusters do not contribute to the width.

```ts pmcp-example
import assert from 'node:assert/strict';
import stringWidth from 'string-width';

assert.equal(stringWidth('a'), 1);
assert.equal(stringWidth('hello'), 5);
assert.equal(stringWidth('古'), 2);
assert.equal(stringWidth('古a'), 3);
assert.equal(stringWidth('\t'), 0);
assert.equal(stringWidth('\n'), 0);
```

## Options

### `ambiguousIsNarrow`

`ambiguousIsNarrow` defaults to `true`. With the default, East Asian Ambiguous characters count as one column. Set it to `false` to count them as wide.

The middle dot `·` is an example of an ambiguous-width character:

```ts pmcp-example
import assert from 'node:assert/strict';
import stringWidth from 'string-width';

assert.equal(stringWidth('·'), 1);
assert.equal(stringWidth('·', {ambiguousIsNarrow: true}), 1);
assert.equal(stringWidth('·', {ambiguousIsNarrow: false}), 2);
```

### `countAnsiEscapeCodes`

ANSI escape codes are excluded by default. Set `countAnsiEscapeCodes: true` when those codes should contribute to the returned width.

```ts pmcp-example
import assert from 'node:assert/strict';
import stringWidth from 'string-width';

const styled = '\u001B[1m古\u001B[22m';

assert.equal(stringWidth(styled), 2);
assert.ok(stringWidth(styled, {countAnsiEscapeCodes: true}) > stringWidth(styled));
```

## Unicode and grapheme behavior

The v8 implementation segments grapheme clusters and applies emoji-specific width rules before East Asian Width handling. A displayed emoji such as `😀` occupies two columns:

```ts pmcp-example
import assert from 'node:assert/strict';
import stringWidth from 'string-width';

assert.equal(stringWidth('😀'), 2);
assert.equal(stringWidth('a😀古'), 5);
```

This means do not calculate width by simply using JavaScript `string.length`: surrogate pairs, combined graphemes, emoji, fullwidth characters, and control sequences do not map directly to terminal columns.

## Common mistakes

- **Using `require`:** v8 is ESM-only in its documented package shape. Use a default `import` and run under a Node version satisfying `>=20`.
- **Treating `string.length` as display width:** use `stringWidth` because fullwidth Unicode characters and emoji can occupy two columns, while controls and ANSI sequences may occupy none.
- **Assuming ANSI styling changes visual width:** ANSI escape codes are ignored by default. Pass `countAnsiEscapeCodes: true` only when the escape-code characters themselves should be included.
- **Assuming ambiguous characters are always wide:** the default is narrow (`ambiguousIsNarrow: true`). Set it to `false` for wide treatment.
- **Expecting tabs to expand to tab stops:** tabs are ignored by this implementation.
- **Copying the v6 dependency/runtime assumptions:** v8 requires Node `>=20` and uses the v8 ESM export shape. The older v6 package supported Node `>=16`, which is not the v8 requirement.

## Not covered

This skill does not cover terminal-specific rendering differences, custom tab-stop calculations, layout or padding APIs, ANSI code generation, or behavior outside the documented v8 options and string-width calculation.

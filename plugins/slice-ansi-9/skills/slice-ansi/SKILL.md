---
name: slice-ansi
description: Use slice-ansi@^9.0.0 to slice ANSI-styled strings by visible-column positions while preserving ANSI codes and grapheme clusters.
---

Verified against slice-ansi@9.0.0 on 2026-09-08. 6 of 6 examples executed.

# slice-ansi

## What it does

`slice-ansi` is an ESM package whose only documented public API is a default-exported function for slicing strings that contain ANSI escape codes. It slices by zero-based visible-column positions rather than raw JavaScript string indexes. Grapheme clusters, including emoji sequences and combining marks, are kept intact.

Version 9 requires Node `>=22`.

```ts
import sliceAnsi from 'slice-ansi';

sliceAnsi(string: string, startSlice: number, endSlice?: number): string;
```

`endSlice` is optional. When supplied, it is the zero-based visible-column endpoint. If a complete grapheme cluster would cross that endpoint, that grapheme cluster is excluded.

## Import and runtime requirements

The package is ESM. Use a static default import:

```ts pmcp-example
import assert from 'node:assert/strict';
import sliceAnsi from 'slice-ansi';

const input = '\u001B[31mred\u001B[39m';
assert.equal(sliceAnsi(input, 0, 3), input);
```

Run examples with Node 22 or newer. Do not use `require()` or assume there are named exports. The package export map documents the default function and its types; no other documented public functions are exposed.

## ANSI-styled strings

Pass the complete string, including its ANSI escape sequences. Indexes refer to visible columns, not the escape sequences themselves.

```ts pmcp-example
import assert from 'node:assert/strict';
import sliceAnsi from 'slice-ansi';

const input = 'plain \u001B[31mred\u001B[39m tail';
const result = sliceAnsi(input, 6, 9);

assert.equal(result, '\u001B[31mred\u001B[39m');
```

The package can be used directly without `chalk` or another styling package. Styling libraries are only one possible source of ANSI escape codes.

## Grapheme clusters

Do not calculate boundaries with `string.length` or assume that one JavaScript code unit is one visible character. Emoji sequences and combining-mark sequences are preserved as grapheme clusters.

An emoji sequence can occupy two visible columns. Select its complete visible-column range rather than cutting it at a code-unit boundary:

```ts pmcp-example
import assert from 'node:assert/strict';
import sliceAnsi from 'slice-ansi';

const input = 'A👩‍💻B';
assert.equal(sliceAnsi(input, 1, 3), '👩‍💻');
```

A combining-mark sequence remains intact when selected as one visible column:

```ts pmcp-example
import assert from 'node:assert/strict';
import sliceAnsi from 'slice-ansi';

const input = 'e\u0301X';
assert.equal(sliceAnsi(input, 0, 1), 'e\u0301');
```

When an endpoint would cut across a complete grapheme cluster, that cluster is excluded rather than returned partially:

```ts pmcp-example
import assert from 'node:assert/strict';
import sliceAnsi from 'slice-ansi';

const input = 'A👩‍💻B';
assert.equal(sliceAnsi(input, 0, 2), 'A');
```

## Omitting the endpoint

`endSlice` may be omitted to take the visible suffix beginning at `startSlice`.

```ts pmcp-example
import assert from 'node:assert/strict';
import sliceAnsi from 'slice-ansi';

assert.equal(sliceAnsi('abcdef', 3), 'def');
assert.equal(sliceAnsi('\u001B[32mhello\u001B[39m', 2), '\u001B[32mllo\u001B[39m');
```

## Common mistakes

- **Using the older generic-index explanation:** v9 documents `startSlice` and `endSlice` as visible-column positions. ANSI control sequences do not consume visible columns.
- **Splitting graphemes yourself:** do not convert the string to code units or assume emoji and combining marks can be sliced independently. v9 keeps grapheme clusters intact.
- **Assuming `endSlice` is inclusive:** it is an endpoint; a grapheme cluster that would cross it is excluded.
- **Using a CommonJS or named import:** v9 is ESM and exposes one documented default export.
- **Running on an older Node version:** the v9 package metadata requires Node `>=22`.
- **Expecting a CLI or test-runner API:** this package exports a function for direct use in a script. `describe`, `it`, and `expect` are not part of its API.

## Not covered

This skill does not cover undocumented behavior, invalid argument handling, negative or non-finite indexes, detailed ANSI escape-code edge cases, terminal-width behavior beyond the documented visible-column and grapheme-cluster rules, or package development commands and tests.

---
name: figures
description: Use figures 6.x to render Unicode symbols with terminal-aware fallbacks, access explicit main/fallback symbol sets, and replace symbols in strings.
---

Verified against figures@6.1.0 on 2026-09-08. 3 of 3 examples executed.

# figures

`figures` 6.x is a native ESM package for Unicode symbols with fallbacks for terminals that do not support all Unicode figures. The documented version is 6.1.0 and it requires Node.js 18 or newer.

## Imports and package shape

Use named exports for the symbol collections and replacement helper:

```ts
import figures, {mainSymbols, fallbackSymbols, replaceSymbols} from 'figures';
```

The default export is the terminal-selected figure set. `mainSymbols` always contains the Unicode symbols, while `fallbackSymbols` always contains their fallback equivalents. The listed figures are also attached to the default export, so `figures.tick`, `figures.star`, `figures.line`, and similar properties are valid.

Do not rely on the commonly copied v5-style shape:

```ts
figures.mainSymbols.tick
figures.fallbackSymbols.tick
figures.replaceSymbols('✔ check')
```

In v6, use the named exports `mainSymbols`, `fallbackSymbols`, and `replaceSymbols`. The v6 package is native ESM, so use `import`, not CommonJS `require`.

## Default terminal-selected symbols

The default export selects symbols using terminal Unicode support detection. For example, `figures.tick` is `✔` on a Unicode-capable terminal and `√` otherwise. Because selection is environment-dependent, do not assert one exact value for the default export in portable tests.

```ts pmcp-example
import assert from 'node:assert/strict';
import figures, {mainSymbols, fallbackSymbols} from 'figures';

assert.ok(typeof figures.tick === 'string');
assert.ok(figures.tick === mainSymbols.tick || figures.tick === fallbackSymbols.tick);
assert.equal(typeof figures.star, 'string');
assert.equal(typeof figures.line, 'string');
```

The default export includes the documented figure names, including common status symbols such as `tick`, `info`, `warning`, and `cross`; shapes such as `circle`, `checkboxOn`, `pointer`, and `star`; arrows and fractions; and box-drawing names such as `line`, `lineBold`, `lineVertical`, and `lineCross`.

## Explicit symbol sets

Use `mainSymbols` when output must always use the Unicode figures, regardless of the terminal. Use `fallbackSymbols` when output must always use the fallback figures.

```ts pmcp-example
import assert from 'node:assert/strict';
import {mainSymbols, fallbackSymbols} from 'figures';

assert.equal(mainSymbols.tick, '✔');
assert.equal(fallbackSymbols.tick, '√');
assert.equal(typeof mainSymbols.info, 'string');
assert.equal(typeof fallbackSymbols.warning, 'string');
assert.equal(typeof mainSymbols.lineCross, 'string');
assert.equal(typeof fallbackSymbols.oneSeventh, 'string');
```

Both collections expose readonly string properties. Do not mutate them.

## Replacing symbols in text

`replaceSymbols(string, options?)` replaces recognized main symbols with the terminal-appropriate versions by default. Pass `{useFallback: true}` to force fallback symbols even on a Unicode-capable terminal.

```ts pmcp-example
import assert from 'node:assert/strict';
import {replaceSymbols} from 'figures';

const input = '✔ check';
const replaced = replaceSymbols(input);

assert.ok(replaced === '✔ check' || replaced === '√ check');
assert.equal(replaceSymbols(input, {useFallback: true}), '√ check');
```

The option type is:

```ts
type Options = {
	readonly useFallback?: boolean;
};
```

`useFallback: true` is the v6.1 addition. Use it when generated output must be stable and use fallback symbols rather than depending on terminal detection.

## Terminal behavior

The default set and `replaceSymbols()` without `useFallback` are terminal-sensitive. Unsupported terminals documented by the package include `xterm`, Linux Terminal (kernel), and `cmder`; they can display most but not all symbols. Prefer `fallbackSymbols` or `replaceSymbols(text, {useFallback: true})` when compatibility matters.

In v6.0, `circleQuestionMark` and `questionMarkPrefix` are always displayed as `(?)`. Older macOS-specific circled-question-mark behavior should not be expected.

## What this skill does not cover

This skill does not cover symbols beyond the documented named properties, terminal detection internals, or behavior of terminals not described by the package research. It also does not cover a CLI, build step, or test-runner integration: the package exposes no such tool surface in the researched material and is used directly from a Node ESM script.

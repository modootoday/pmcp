---
name: chalk
description: Use chalk@^6.0.0 correctly from Node.js 22+ ESM, including deterministic color levels, v6 underline styles/colors, Chalk instances, and exported capability metadata.
---

Verified against chalk@6.0.0 on 2026-09-08. 6 of 6 examples executed.

# chalk@^6.0.0

## Runtime and package shape

- Chalk 6 is ESM-only and requires Node.js 22 or newer.
- Import the default export or named exports from `chalk`. Do not use `require()` or assume a CommonJS entry point.
- Chalk formats strings; it is not a command-line runner. Direct scripts can use its formatting API, while command-line usage belongs to the separate `chalk-cli` package.

```ts pmcp-example
import assert from 'node:assert/strict';
import chalk, {Chalk} from 'chalk';

assert.equal(typeof chalk, 'function');
assert.equal(typeof Chalk, 'function');

const plain = new Chalk({level: 0});
assert.equal(plain.blue('hello'), 'hello');
assert.equal(plain.bold.red('error'), 'error');
```

## Chaining styles and arguments

A style chain is callable: `chalk.<style>[.<style>...](text, ...moreText)`. Multiple arguments are separated by spaces. A chain can be saved and reused because the chain itself is callable.

```ts pmcp-example
import assert from 'node:assert/strict';
import {Chalk} from 'chalk';

const color = new Chalk({level: 3});

const error = color.bold.red;
const warning = color.hex('#FFA500');

assert.equal(error('Error!'), '\u001b[1m\u001b[31mError!\u001b[39m\u001b[22m');
assert.equal(warning('Warning!'), '\u001b[38;2;255;165;0mWarning!\u001b[39m');
assert.equal(color.red('Hello', color.underline.bgBlue('world') + '!'), '\u001b[31mHello \u001b[4m\u001b[44mworld\u001b[49m\u001b[24m!\u001b[39m');
assert.equal(color.rgb(123, 45, 67).underline('Underlined reddish color'), '\u001b[38;2;123;45;67m\u001b[4mUnderlined reddish color\u001b[24m\u001b[39m');
```

## Color levels and `Chalk`

Use `new Chalk({level})` when output must be deterministic. Levels are `0` through `3`; level `0` disables styling and level `3` enables truecolor. A `Chalk` instance is callable and its `.level` can be changed later.

Do not rely on the default instance's detected level in tests or examples: it depends on the environment. Numeric `FORCE_COLOR` selects that exact level; `FORCE_COLOR=true` enables color while retaining detection.

```ts pmcp-example
import assert from 'node:assert/strict';
import {Chalk} from 'chalk';

const customChalk = new Chalk({level: 0});
assert.equal(customChalk.red('not red'), 'not red');

customChalk.level = 3;
const truecolor = customChalk.rgb(15, 100, 204)('Truecolor');
assert.notEqual(truecolor, 'Truecolor');
assert.ok(truecolor.includes('15;100;204'));
```

## v6 underline styles and underline colors

Version 6 adds `underlineDouble`, `underlineCurly`, `underlineDotted`, and `underlineDashed`. Underline colors use methods such as `underlineHex`, `underlineRgb`, and `underlineAnsi256`; an underline style must also be applied. There is no basic 16-color underline form.

```ts pmcp-example
import assert from 'node:assert/strict';
import {Chalk} from 'chalk';

const color = new Chalk({level: 3});

const typo = color.underlineHex('#DEADED').underlineCurly('typo');
const notice = color.underlineRgb(15, 100, 204).underlineDouble('Hello!');
const dotted = color.underlineDotted('dotted');
const dashed = color.underlineDashed('dashed');

for (const value of [typo, notice, dotted, dashed]) {
  assert.notEqual(value, value.replace(/\u001b\[[0-9;]*m/g, ''));
}
assert.ok(typo.includes('222;173;237'));
assert.ok(notice.includes('15;100;204'));
```

## Color models

The documented color-model methods include `rgb`, `hex`, and `ansi256`, with background equivalents `bgRgb`, `bgHex`, and `bgAnsi256`, and underline equivalents `underlineRgb`, `underlineHex`, and `underlineAnsi256`. At level 1, `ansi256()` and `bgAnsi256()` are downsampled to the 16-color range.

```ts pmcp-example
import assert from 'node:assert/strict';
import {Chalk} from 'chalk';

const color = new Chalk({level: 3});

assert.ok(color.rgb(1, 2, 3)('x').includes('1;2;3'));
assert.ok(color.hex('#010203')('x').includes('1;2;3'));
assert.ok(color.ansi256(100)('x').includes('38;5;100'));
assert.ok(color.bgRgb(1, 2, 3)('x').includes('48;2;1;2;3'));
assert.ok(color.bgHex('#010203')('x').includes('48;2;1;2;3'));
assert.ok(color.bgAnsi256(100)('x').includes('48;5;100'));
assert.ok(color.underlineRgb(1, 2, 3).underline('x').includes('58;2;1;2;3'));
assert.ok(color.underlineHex('#010203').underline('x').includes('58;2;1;2;3'));
assert.ok(color.underlineAnsi256(100).underline('x').includes('58;5;100'));
```

## Named exports and stderr instance

The package exports `chalkStderr`, a separate instance configured using stderr color support, plus `supportsColor` and `supportsColorStderr`. It also exports style-name arrays:

- `modifierNames`
- `foregroundColorNames`
- `backgroundColorNames`
- `underlineColorNames`
- `colorNames`

Aliases include `modifiers`, `foregroundColors`, `backgroundColors`, and `colors`.

```ts pmcp-example
import assert from 'node:assert/strict';
import {
  chalkStderr,
  modifierNames,
  foregroundColorNames,
  backgroundColorNames,
  underlineColorNames,
  colorNames,
  modifiers,
  foregroundColors,
  backgroundColors,
  colors,
  supportsColor,
  supportsColorStderr,
} from 'chalk';

assert.equal(typeof chalkStderr, 'function');
assert.ok(modifierNames.includes('bold'));
assert.ok(foregroundColorNames.includes('red'));
assert.ok(Array.isArray(backgroundColorNames));
assert.ok(Array.isArray(underlineColorNames));
assert.ok(Array.isArray(colorNames));
assert.equal(modifiers, modifierNames);
assert.equal(foregroundColors, foregroundColorNames);
assert.equal(backgroundColors, backgroundColorNames);
assert.equal(colors, colorNames);
assert.ok(typeof supportsColor === 'boolean' || typeof supportsColor === 'object');
assert.ok(typeof supportsColorStderr === 'boolean' || typeof supportsColorStderr === 'object');
assert.notEqual(chalkStderr, undefined);
```

## Common mistakes

- Do not copy a CommonJS `require('chalk')` shape from older examples; Chalk 6 is ESM-only.
- Do not assume the older package metadata or older Node.js support applies. Chalk 6 requires Node.js 22+.
- Do not test the default `chalk` output as colored without controlling the color level; terminal/environment detection may disable color.
- Do not treat `underlineHex`, `underlineRgb`, or `underlineAnsi256` as complete underline styles by themselves. Combine them with an underline style such as `underline`, `underlineCurly`, or `underlineDouble`.
- Do not expect a basic 16-color underline API; underline colors are exposed through the color-model methods.
- Do not assume that every intuitive color name is present in `foregroundColorNames`; use the exported arrays to discover supported names rather than asserting an unsupported name such as `pink`.
- Do not assume `ansi256()` always emits a 256-color sequence: at level 1 it is downsampled to 16 colors.
- Do not use `describe`, `it`, or `expect` in a directly executed script. Chalk does not provide test-runner globals.
- Do not use Chalk as the CLI executable. The separately documented `chalk-cli` package provides command-line behavior.

## Not covered

This skill does not cover Chalk's complete style-name list or every escape-sequence detail, terminal-specific color detection behavior, invalid color argument handling, TypeScript compiler configuration, or `chalk-cli` command syntax. It also does not cover framework or test-runner integration.

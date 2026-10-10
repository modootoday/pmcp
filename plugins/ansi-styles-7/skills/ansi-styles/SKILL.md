---
name: ansi-styles
description: Use ansi-styles v7.0.0 to generate ANSI escape sequences, inspect style groups, convert RGB/hex colors, and work with underline colors. Requires Node.js 22 or newer and ESM imports.
---

Verified against ansi-styles@7.0.0 on 2026-09-08. 5 of 5 examples executed.

# ansi-styles

`ansi-styles` v7.0.0 is an ESM package for generating ANSI escape codes. It requires Node.js 22 or newer. The package has no runtime dependencies and is directly importable from a plain script.

## Import shape

Use the default export for styles and conversion helpers, or named exports for the style-name arrays:

```ts pmcp-example
import assert from 'node:assert/strict';
import styles, {
  modifierNames,
  foregroundColorNames,
  backgroundColorNames,
  underlineColorNames,
  colorNames,
} from 'ansi-styles';

assert.ok(modifierNames.includes('bold'));
assert.ok(foregroundColorNames.includes('green'));
assert.ok(backgroundColorNames.includes('bgGreen'));
assert.ok(underlineColorNames.includes('underlineRed'));
assert.ok(colorNames.includes('green'));
assert.ok(colorNames.includes('bgGreen'));
assert.ok(!colorNames.includes('underlineRed'));
```

The package is ESM (`type: module`), so use `import`, not CommonJS `require`. `colorNames` combines foreground and background names; underline color names are kept in the separate `underlineColorNames` array.

## Styles and groups

The default export exposes styles directly and through these groups:

- `modifier`
- `color`
- `bgColor`
- `underlineColor`

A style has `open` and `close` strings. Wrap text with the matching pair:

```ts pmcp-example
import assert from 'node:assert/strict';
import styles from 'ansi-styles';

const text = `${styles.green.open}Hello world!${styles.green.close}`;
assert.equal(text, '\u001B[32mHello world!\u001B[39m');
assert.equal(styles.color.green.open, styles.green.open);
assert.equal(styles.color.green.close, styles.green.close);
assert.ok(styles.bgColor.bgGreen.open.length > 0);
assert.ok(styles.modifier.bold.open.length > 0);
assert.ok(styles.modifier.bold.close.length > 0);
```

Use the group form when the category matters, or the direct form for common foreground styles. Always close a style after the text it affects.

## ANSI color conversions

The default export provides these conversion helpers:

- `rgbToAnsi256(red, green, blue): number`
- `rgbToAnsi(red, green, blue): number`
- `hexToRgb(hex): [red, green, blue]`
- `hexToAnsi256(hex): number`
- `hexToAnsi(hex): number`
- `ansi256ToAnsi(code): number`

The corresponding `ansi`, `ansi256`, and `ansi16m` style-group methods turn converted values into escape sequences:

```ts pmcp-example
import assert from 'node:assert/strict';
import styles from 'ansi-styles';

const rgb = styles.hexToRgb('#abcdef');
assert.deepEqual(rgb, [171, 205, 239]);

const ansi256 = styles.rgbToAnsi256(199, 20, 250);
const ansi = styles.rgbToAnsi(199, 20, 250);
const fromHex256 = styles.hexToAnsi256('#abcdef');
const fromHex = styles.hexToAnsi('#abcdef');

for (const value of [ansi256, ansi, fromHex256, fromHex]) {
  assert.equal(typeof value, 'number');
}
assert.equal(typeof styles.ansi256ToAnsi(ansi256), 'number');

assert.ok(styles.color.ansi(ansi).length > 0);
assert.ok(styles.color.ansi256(ansi256).length > 0);
assert.ok(styles.color.ansi16m(...rgb).length > 0);

const output = `${styles.color.ansi(styles.rgbToAnsi(199, 20, 250))}Hello World${styles.color.close}`;
assert.ok(output.includes('Hello World'));
```

For truecolor output, pass the three RGB components to `ansi16m`. For 256-color output, pass the numeric result of `rgbToAnsi256` or `hexToAnsi256` to `ansi256`.

## Underline styles and underline colors

v7 adds extended underline modifiers and underline colors:

- `modifier.underlineDouble`
- `modifier.underlineCurly`
- `modifier.underlineDotted`
- `modifier.underlineDashed`
- `underlineColor.underlineRed`

Underline colors are independent from the text color. They are visible only when an underline style is also active. `underlineColor.ansi()` uses the first 16 entries of the 256-color palette.

```ts pmcp-example
import assert from 'node:assert/strict';
import styles from 'ansi-styles';

assert.ok(styles.modifier.underlineDouble.open.length > 0);
assert.ok(styles.modifier.underlineCurly.open.length > 0);
assert.ok(styles.modifier.underlineDotted.open.length > 0);
assert.ok(styles.modifier.underlineDashed.open.length > 0);
assert.ok(styles.underlineColor.underlineRed.open.length > 0);

const underlineRgb = styles.hexToRgb('#C0FFEE');
const underlined = [
  styles.modifier.underlineCurly.open,
  styles.underlineColor.ansi(styles.rgbToAnsi(100, 200, 15)),
  'Hello World',
  styles.underlineColor.close,
  styles.modifier.underlineCurly.close,
].join('');

assert.ok(underlined.includes('Hello World'));
assert.ok(styles.underlineColor.ansi256(styles.hexToAnsi256('#C0FFEE')).length > 0);
assert.ok(styles.underlineColor.ansi16m(...underlineRgb).length > 0);
```

## The `codes` map

`styles.codes` is a `ReadonlyMap<number, number>` mapping opening color codes to their closing codes:

```ts pmcp-example
import assert from 'node:assert/strict';
import styles from 'ansi-styles';

assert.equal(styles.codes instanceof Map, true);
assert.equal(styles.codes.get(36), 39);
```

## Common v6-to-v7 mistakes

- **Using an old Node version:** v7 requires Node.js 22 or newer. The v6 requirement was Node.js 12 or newer, so code that worked on an older runtime may fail before import.
- **Missing the new underline-color group:** v6 examples commonly show only `modifier`, `color`, and `bgColor`. In v7, use `underlineColor` and `underlineColorNames` for underline colors.
- **Expecting underline colors in `colorNames`:** `colorNames` combines foreground and background names; underline names remain in `underlineColorNames`.
- **Applying an underline color without an underline modifier:** an underline color alone is not visible. Combine it with an underline style such as `underlineCurly` or `underlineDouble`.
- **Treating the package as a string-styling framework:** `ansi-styles` emits escape-code strings. It does not provide `describe`, `it`, or `expect`, and examples must use its programmatic API directly. The higher-level package recommended by the README is Chalk.

## Not covered

This skill does not cover Chalk usage, terminal capability detection, rendering differences between terminals, the repository's screenshot development script, or its repository test tooling. It also does not cover APIs or behavior not shown by the supplied research.

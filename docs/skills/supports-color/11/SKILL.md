---
name: supports-color
description: Use supports-color 11.0.0 to detect terminal color capability in Node.js scripts, including stdout/stderr detection and custom stream detection.
---

Verified against supports-color@11.0.0 on 2026-09-08. 3 of 3 examples executed.

# supports-color 11.0.0

## Runtime and module shape

- Version 11 requires Node.js `>=22`.
- The package is ESM. Import it with `import`, not CommonJS `require`.
- The default export is an object with `stdout` and `stderr` properties. Each property is either a `ColorSupport` object or `false`.
- Do not use the older assumption that the default export itself is a color-support object. Check `supportsColor.stdout` or `supportsColor.stderr` first.

```ts pmcp-example
import assert from 'node:assert/strict';
import supportsColor from 'supports-color';

assert.equal(typeof supportsColor, 'object');
assert.ok('stdout' in supportsColor);
assert.ok('stderr' in supportsColor);

for (const streamSupport of [supportsColor.stdout, supportsColor.stderr]) {
	if (streamSupport !== false) {
		assert.ok([1, 2, 3].includes(streamSupport.level));
		assert.equal(streamSupport.hasBasic, streamSupport.level >= 1);
		assert.equal(streamSupport.has256, streamSupport.level >= 2);
		assert.equal(streamSupport.has16m, streamSupport.level >= 3);
	}
}
```

## Reading capability levels

A truthy color-support object has these properties:

- `level: 1` means basic ANSI color support, including 16 colors.
- `level: 2` means 256-color support.
- `level: 3` means 16-million-color Truecolor support.
- `hasBasic`, `has256`, and `has16m` are boolean convenience properties corresponding to those levels.

Always guard a stream result before reading its properties, because it can be `false`.

```ts pmcp-example
import assert from 'node:assert/strict';
import supportsColor from 'supports-color';

const stdout = supportsColor.stdout;

if (stdout) {
	assert.equal(typeof stdout.level, 'number');
	assert.equal(typeof stdout.hasBasic, 'boolean');
	assert.equal(typeof stdout.has256, 'boolean');
	assert.equal(typeof stdout.has16m, 'boolean');

	if (stdout.level >= 3) {
		assert.equal(stdout.has16m, true);
	}
}
```

## Custom stream detection

The named programmatic API is `createSupportsColor` (plural):

```ts
import {createSupportsColor} from 'supports-color';
```

The README prose for this release incorrectly calls it `createSupportColor` (singular). The singular spelling is not the declaration or implementation export.

Its signature is:

```ts
createSupportsColor(stream?: WriteStream, options?: {readonly sniffFlags?: boolean}): ColorSupport | false
```

Pass a Node `WriteStream`, such as `process.stdout`, when detecting a specific stream. `sniffFlags` defaults to `true`; set it to `false` when `process.argv` color flags must not affect the result.

```ts pmcp-example
import assert from 'node:assert/strict';
import {createSupportsColor} from 'supports-color';

const detected = createSupportsColor(process.stdout, {sniffFlags: false});

if (detected !== false) {
	assert.ok([1, 2, 3].includes(detected.level));
	assert.equal(typeof detected.hasBasic, 'boolean');
	assert.equal(typeof detected.has256, 'boolean');
	assert.equal(typeof detected.has16m, 'boolean');
}
```

## Environment and command-line controls

Detection considers runtime inputs:

- `--color` enables color.
- `--no-color` disables color.
- `--color=256` requests level 2.
- `--color=16m` requests level 3.
- `FORCE_COLOR=0`, `1`, `2`, `3`, or `true` affects detection.
- In v11, a numeric `FORCE_COLOR` is treated as an exact color-support level.

These values are process context, not a separate runner API. If using `createSupportsColor`, set `sniffFlags: false` to prevent `process.argv` color flags from being considered.

## Browser condition

The package exports Node or browser code conditionally. In Node, use the Node entry for stream detection. The browser entry exposes `stdout` and `stderr` based on `navigator`/Chromium user-agent data and does not expose `createSupportsColor`; it cannot replace Node stream detection.

## Does not cover

This skill does not cover the internal terminal/platform heuristics, the exact precedence among every environment and command-line input, browser user-agent detection details, or integrating the result with a particular color-output library.

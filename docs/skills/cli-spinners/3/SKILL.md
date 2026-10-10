---
name: cli-spinners
description: Use cli-spinners ^3.0.0 as a pure ESM source of spinner definitions and random spinner selection.
---

Verified against cli-spinners@3.4.0 on 2026-09-08. 3 of 3 examples executed.

# cli-spinners

`cli-spinners` provides spinner data. It does not render, animate, or run a CLI. The package is pure ESM and requires Node `>=18.20`.

## Import the package

Use the default export for the spinner collection:

```ts pmcp-example
import assert from 'node:assert/strict';
import cliSpinners from 'cli-spinners';

const dots = cliSpinners.dots;

assert.equal(dots.interval, 80);
assert.deepEqual(dots.frames, ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']);
assert.equal(cliSpinners.line.interval, 130);
assert.ok(Array.isArray(cliSpinners.hearts.frames));
```

Each spinner has:

- `interval`: the recommended time per frame, in milliseconds.
- `frames`: an array of strings.

The collection includes names such as `dots`, `dots2` through `dots12`, `dots8Bit`, `sand`, `line`, `binary`, `material`, `weather`, `christmas`, `betaWave`, `fingerDance`, `fistBump`, `soccerHeader`, `mindblown`, `speaker`, `orangePulse`, `bluePulse`, `orangeBluePulse`, `timeTravel`, `aesthetic`, and `dwarfFortress`.

## Select a random spinner

Import `randomSpinner` as a named export:

```ts pmcp-example
import assert from 'node:assert/strict';
import cliSpinners, {randomSpinner} from 'cli-spinners';

const spinner = randomSpinner();

assert.equal(typeof spinner.interval, 'number');
assert.ok(Array.isArray(spinner.frames));
assert.ok(spinner.frames.length > 0);
assert.ok(Object.values(cliSpinners).includes(spinner));
```

`randomSpinner()` returns one of the spinner objects from the default collection. It does not return a spinner name.

## Use the data in an animation

The package only supplies data. A consumer must implement the timing and output, or pass the spinner definition to another package that renders it. `interval` is the suggested delay between frames; `frames` supplies the strings to display.

```ts pmcp-example
import assert from 'node:assert/strict';
import cliSpinners from 'cli-spinners';

const spinner = cliSpinners.dots;
const displayedFrames: string[] = [];

for (const frame of spinner.frames) {
	displayedFrames.push(frame);
}

assert.deepEqual(displayedFrames, spinner.frames);
assert.equal(typeof spinner.interval, 'number');
```

## Important migration notes

Version 3 is not the older CommonJS API. Do not use:

```js
const spinners = require('cli-spinners');
spinners.random;
```

The old `random` property was replaced by the named `randomSpinner()` function:

```js
import {randomSpinner} from 'cli-spinners';

const spinner = randomSpinner();
```

Likewise, use a default ESM import for the collection:

```js
import cliSpinners from 'cli-spinners';

const spinner = cliSpinners.dots;
```

The TypeScript surface defines a `Spinner` with readonly numeric `interval` and readonly string-array `frames`. `randomSpinner()` returns a `Spinner`.

## What this skill does not cover

This skill does not cover spinner rendering, animation loops, terminal cursor control, CLI integration, or a specific renderer such as `ora`; those are outside this package's documented surface. It also does not cover consuming internal package files directly or package versions before 3.0.0.

---
name: human-signals
description: Use human-signals ^8.0.0 as an ES-module lookup table for signal metadata by name or number.
---

Verified against human-signals@8.0.1 on 2026-09-08. 2 of 2 examples executed.

# human-signals

## What this package provides

`human-signals` 8.x is an ES module with no runtime dependencies. It requires Node.js `>=18.18.0` and documents two named exports:

- `signalsByName`: signal name → signal object
- `signalsByNumber`: signal number → signal object

There are no documented functions, CLI commands, or runner APIs. Import the package with ES `import` or dynamic `import()`; do not use CommonJS `require()`. TypeScript output must be ES modules rather than CommonJS.

## Look up a signal by name

Use an established signal name such as `SIGINT`. Signal names are strict: lowercase names such as `sigint` and unknown names such as `SIGOTHER` are not valid v8 signal names.

```ts pmcp-example
import assert from 'node:assert/strict'
import { signalsByName } from 'human-signals'

const sigint = signalsByName.SIGINT

assert.equal(sigint.name, 'SIGINT')
assert.equal(sigint.number, 2)
assert.equal(sigint.description, 'User interruption with CTRL-C')
assert.equal(sigint.supported, true)
assert.equal(sigint.action, 'terminate')
assert.equal(sigint.forced, false)
assert.equal(sigint.standard, 'ansi')
```

Each value is a signal object with these fields:

- `name: string`
- `number: number`
- `description: string`
- `supported: boolean`
- `action: 'terminate' | 'core' | 'ignore' | 'pause' | 'unpause'`
- `forced: boolean`
- `standard: 'ansi' | 'posix' | 'bsd' | 'systemv' | 'other'`

## Look up a signal by number

Use a valid signal number as the key. In v8, the TypeScript signal-number types accept valid signal numbers such as `1` or `9`; they do not accept `-1`, `1.5`, or `999`. `0` is not a valid signal number for the package types, even though it may be passed to `process.kill()`.

```ts pmcp-example
import assert from 'node:assert/strict'
import { signalsByNumber } from 'human-signals'

const sigfpe = signalsByNumber[8]

assert.equal(sigfpe.name, 'SIGFPE')
assert.equal(sigfpe.number, 8)
assert.equal(sigfpe.description, 'Floating point arithmetic error')
assert.equal(sigfpe.supported, true)
assert.equal(sigfpe.action, 'core')
assert.equal(sigfpe.forced, false)
assert.equal(sigfpe.standard, 'ansi')
```

## Platform support

`signal.supported` is OS-specific. It reflects whether Node.js can handle that signal with `process.on(name, handler)`. Do not treat the field as a universal claim that every operating system supports the signal.

## Version and compatibility pitfalls

- The current release in the documented `^8.0.0` range is `8.0.1`.
- v8 made signal-number types stricter. Do not carry forward code that uses `-1`, fractional numbers, `999`, or `0` as a package signal number.
- Signal names are strict in the older tightened shape as well: use valid uppercase names such as `SIGINT`, not lowercase or invented names.
- The package is ESM-only according to the documentation. A direct `require('human-signals')` is not the documented usage.
- The documented v8 lookup types are `Signal`, not `Signal | undefined`; still, only use documented signal names and valid signal numbers.

## What this skill does not cover

This skill does not cover undocumented exports, the complete signal catalogue, operating-system-specific support results beyond the `supported` field, sending or handling signals with Node.js, CommonJS integration workarounds, or any CLI/runner behavior. The research documents no CLI, runner, or build-step API for this package.

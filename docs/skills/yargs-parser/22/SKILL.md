---
name: yargs-parser
description: Use yargs-parser v22 as a standalone ESM-first argument parser, including its callable parser, detailed results, helper methods, and documented parsing options.
---

Verified against yargs-parser@22.0.0 on 2026-09-08. 8 of 8 examples executed.

# yargs-parser v22

## Import and runtime

`yargs-parser` v22 is ESM-first. In an ESM script, use its default export:

```ts
import parser from 'yargs-parser'
```

The package metadata declares `type: "module"` and supports Node `^20.19.0 || ^22.12.0 || >=23`. The callable default export accepts either a command-line string or an array and returns parsed values, including `_` for positional arguments.

Older examples commonly use `require('yargs-parser')`. Do not copy that shape into an ESM-first v22 application without checking the module environment. The documented v22 import is the default ESM import above.

## Basic parsing

Pass a string or an array of argument strings. Long options support `--name=value` and separated values. Positional arguments are returned in `_`.

```ts pmcp-example
import assert from 'node:assert/strict'
import parser from 'yargs-parser'

const argv = parser('--foo=99 --bar=9987930 positional', {
  string: ['bar']
})

assert.equal(argv.foo, 99)
assert.equal(argv.bar, '9987930')
assert.deepEqual(argv._, ['positional'])
```

When the caller already has an argument vector, pass the array directly rather than joining it into a string:

```ts pmcp-example
import assert from 'node:assert/strict'
import parser from 'yargs-parser'

const argv = parser(['--name', 'Ada', 'file.txt'], {
  string: ['name']
})

assert.equal(argv.name, 'Ada')
assert.deepEqual(argv._, ['file.txt'])
```

## Typed and repeated options

The documented option groups include `string`, `number`, `boolean`, `array`, `count`, `default`, `narg`, `coerce`, `config`, `configObjects`, `configuration`, `envPrefix`, and `normalize`.

Use `string` when a value must not be converted to a number. Use `number` when a numeric option should be treated as numeric. `array` collects repeated values, while `count` increments each time the flag occurs.

```ts pmcp-example
import assert from 'node:assert/strict'
import parser from 'yargs-parser'

const argv = parser([
  '--tag', 'one',
  '--tag', 'two',
  '--verbose',
  '--verbose',
  '--port', '8080'
], {
  array: ['tag'],
  boolean: ['verbose'],
  count: ['verbose'],
  number: ['port']
})

assert.deepEqual(argv.tag, ['one', 'two'])
assert.equal(argv.verbose, 2)
assert.equal(argv.port, 8080)
```

Defaults and coercion are parser options, not post-processing requirements:

```ts pmcp-example
import assert from 'node:assert/strict'
import parser from 'yargs-parser'

const argv = parser('--user ada', {
  string: ['user', 'mode'],
  default: { mode: 'safe' },
  coerce: {
    user: (value: string) => value.toUpperCase()
  }
})

assert.equal(argv.user, 'ADA')
assert.equal(argv.mode, 'safe')
```

`narg` declares how many arguments an option consumes. Keep the declaration consistent with the input shape; it is not equivalent to declaring an option as an array.

## Detailed parsing

`parser.detailed(args, opts)` returns more than the final argument object. Its result contains `argv`, `error`, `aliases`, `newAliases`, `defaulted`, and `configuration`.

```ts pmcp-example
import assert from 'node:assert/strict'
import parser from 'yargs-parser'

const result = parser.detailed('--foo=99', {
  alias: { foo: ['f'] }
})

assert.equal(result.error, null)
assert.equal(result.argv.foo, 99)
assert.equal(result.argv.f, 99)
assert.ok(result.aliases)
assert.ok(result.newAliases)
assert.ok(result.defaulted)
assert.ok(result.configuration)
```

Use the detailed form when the caller needs to distinguish parser metadata, aliases, defaults, configuration, or an error from the final `argv` object. Use the callable form when only parsed arguments are needed.

## Helper exports

The default parser function exposes these helpers:

- `parser.camelCase(str)`
- `parser.decamelize(str, joinString?)`
- `parser.looksLikeNumber(value)`

```ts pmcp-example
import assert from 'node:assert/strict'
import parser from 'yargs-parser'

assert.equal(parser.camelCase('foo-bar'), 'fooBar')
assert.equal(parser.decamelize('fooBar'), 'foo-bar')
assert.equal(parser.looksLikeNumber('99.3'), true)
assert.equal(parser.looksLikeNumber('not-a-number'), false)
```

## Environment and configuration-related options

`envPrefix` reads matching prefixed environment variables. Set the environment in the process before parsing if a standalone script needs to exercise this behavior:

```ts pmcp-example
import assert from 'node:assert/strict'
import parser from 'yargs-parser'

process.env.DEMO_PORT = '4321'
const argv = parser('', { envPrefix: 'DEMO' })

assert.equal(argv.port, 4321)
```

`configObjects` accepts configuration objects directly and is suitable when configuration is already available in memory:

```ts pmcp-example
import assert from 'node:assert/strict'
import parser from 'yargs-parser'

const argv = parser('--cli yes', {
  string: ['cli', 'fromConfig'],
  configObjects: [{ fromConfig: 'memory' }]
})

assert.equal(argv.cli, 'yes')
assert.equal(argv.fromConfig, 'memory')
```

`config` loads a configuration-file path, and `normalize` uses `path.normalize()`. These options depend on Node-specific environment or filesystem behavior and are not demonstrated in the standalone examples here.

## `--` values and configuration

The parser can optionally retain values after `--`, depending on the `configuration` options. Treat this as an explicit parser configuration rather than assuming every invocation exposes a `--` property. The returned object may contain the optional `--` values in addition to `_` and named options.

## What this skill does not cover

This skill does not cover yargs itself, command registration, `describe`/`it`/`expect`, CLI runner behavior, browser or Deno entrypoints, the exact filesystem format consumed by `config`, or platform-specific results of `normalize`. It also does not cover options or behaviors not supported by the supplied v22 research.

---
name: yargs
description: Use yargs ^18.0.0 as a factory-based argument parser in supported Node runtimes.
---

Verified against yargs@18.1.0 on 2026-09-08. 7 of 7 examples executed.

# yargs ^18

## Runtime and version constraints

`^18.0.0` stays within major version 18. Version 18 requires Node `^20.19.0 || ^22.12.0 || >=23`.

Version 18 removed the singleton API. Do not use older examples such as `yargs.foo` or `yargs().argv`. Create a parser with the default factory export and explicitly call `.parse()`, `.parseSync()`, or `.parseAsync()`.

```ts pmcp-example
import assert from 'node:assert/strict'
import yargs from 'yargs'

const argv = yargs(['--name', 'Ada', 'file.txt']).parse()

assert.equal(argv.name, 'Ada')
assert.deepEqual(argv._, ['file.txt'])
```

The input array represents arguments after the program name. The factory also accepts `process.argv.slice(2)` directly.

## Normal process-argument parsing

Use `hideBin` when parsing the current process arguments. It is shorthand for `process.argv.slice(2)`.

```ts pmcp-example
import assert from 'node:assert/strict'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

const argv = yargs(hideBin(['node', 'example.ts', '--count', '3', 'input.txt'])).parse()

assert.equal(argv.count, 3)
assert.deepEqual(argv._, ['input.txt'])
```

For a plain script, passing an explicit array is usually easier to test. The `hideBin` helper is exported from `yargs/helpers`, not from the main package entry.

## Options and aliases

Register options with `.option(key, configuration)`. The documented configuration supports fields such as `alias`, `describe`, and `choices`. The convenience methods `.alias()`, `.choices()`, and `.demandOption()` are also available.

```ts pmcp-example
import assert from 'node:assert/strict'
import yargs from 'yargs'

const argv = yargs(['-s', 'm', '--format', 'json'])
  .option('size', {
    alias: 's',
    describe: 'choose a size',
    choices: ['xs', 's', 'm', 'l', 'xl']
  })
  .option('format', { choices: ['json', 'text'] })
  .demandOption('format')
  .parse()

assert.equal(argv.size, 'm')
assert.equal(argv.s, 'm')
assert.equal(argv.format, 'json')
```

The equivalent convenience methods can be used when the option has already been declared:

```ts pmcp-example
import assert from 'node:assert/strict'
import yargs from 'yargs'

const argv = yargs(['--mode', 'fast'])
  .option('mode')
  .alias('mode', 'm')
  .choices('mode', ['fast', 'safe'])
  .parse()

assert.equal(argv.mode, 'fast')
```

`.demandOption(key)` makes the option required. Invalid choices or missing demanded options are validation failures handled by yargs; do not expect them to produce a normal parsed result.

## Commands

Register commands with `.command(cmd, desc, builder, handler)`. A builder configures the command parser and the handler receives the parsed command arguments.

```ts pmcp-example
import assert from 'node:assert/strict'
import yargs from 'yargs'

let received: { url?: string; _: unknown[] } | undefined

const result = yargs(['get', '--url', 'https://example.test'])
  .command(
    'get',
    'make a get request',
    (command) => command.option('url', {
      alias: 'u',
      describe: 'URL to request'
    }),
    (argv) => {
      received = { url: argv.url, _: argv._ }
    }
  )
  .parse()

assert.equal(received?.url, 'https://example.test')
assert.deepEqual(received?._, ['get'])
assert.equal(result.url, 'https://example.test')
```

In v18, command names are no longer derived from modules passed to `.command`; register the command explicitly. Do not call `.parse()` inside a command builder. Parse once at the application level.

Command modules are not standalone parsers. A module registered with `.command()` must expose command-module fields such as `command`, `aliases`, `describe`, `builder`, and `handler`.

`commandDir()` loads command modules from the filesystem. It depends on filesystem/module loading and does not work with Deno. For Deno, import command modules explicitly and pass an array to `.command()` instead.

## Help, version, strictness, and wrapping

The parser exposes `.help([option|boolean])`, `.version([version|boolean])`, `.strict([enabled=true])`, and `.wrap(columns)`.

```ts pmcp-example
import assert from 'node:assert/strict'
import yargs from 'yargs'

const parser = yargs(['--name', 'Ada'])
  .option('name', { type: 'string' })
  .help('help')
  .version('1.2.3')
  .strict()
  .wrap(80)

const argv = parser.parse()
assert.equal(argv.name, 'Ada')
```

`strict()` enables failure for unknown arguments. Use `.wrap(columns)` to set help wrapping. In v18, `wrap(null)` has changed behavior; avoid assuming older-major behavior when migrating.

Help and version flags are CLI output paths: invoke them through the yargs application when the process should display help or version information, rather than treating them as ordinary parsed values.

## Async parsing

Use `.parseAsync()` whenever a builder, handler, middleware, or coercion is asynchronous. It always returns a promise. `.parseSync()` throws if asynchronous work is involved.

```ts pmcp-example
import assert from 'node:assert/strict'
import yargs from 'yargs'

const argv = await yargs(['--value', 'ada'])
  .option('value', { type: 'string' })
  .coerce('value', async (value) => value.toUpperCase())
  .parseAsync()

assert.equal(argv.value, 'ADA')
```

Use `.parseSync()` only for configurations that contain no async builder, handler, or middleware. `.parse()` is the synchronous top-level entry point.

## Migration checklist

- Replace singleton chains with `yargs(args).parse()`.
- Replace `yargs().argv` with an explicit parse call.
- Pass arguments after the program name; use `hideBin(process.argv)` for real process arguments.
- Register command names explicitly instead of relying on module-derived names.
- Do not parse inside command builders.
- Use `.parseAsync()` for asynchronous behavior.
- Account for v18 strict-mode behavior: unknown arguments fail when strict mode is enabled.
- Do not rely on the old behavior where positionals overwrite options.
- `implies` accepts implied values `0`, `false`, and `''` in v18.

## Not covered

This skill does not cover the complete yargs API, detailed validation/error-output customization, middleware, positional-builder syntax beyond the command surface shown here, command-module packaging, filesystem discovery implementation, Deno-specific package URLs, browser bundling, or the behavior of the standalone CLI/tool in a configured application. Those areas require the package's own runtime or additional documentation beyond the researched surface.

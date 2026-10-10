---
name: jackspeak
description: Use jackspeak v4 to declare command-line fields, parse an explicit argument array, validate parsed values, and render usage documentation.
---

Verified against jackspeak@4.2.3 on 2026-09-08. 3 of 3 examples executed.

# jackspeak v4

## Use this skill when

Use the named `jack` export to build a declarative command-line parser. The basic shape is:

```ts
import { jack } from 'jackspeak'

const result = jack(options)
  .flag(fieldDefinitions)
  .opt(fieldDefinitions)
  .parse(args)
```

`parse()` returns `{ positionals, values }`. Pass an explicit `string[]` in library code and tests; its default is `process.argv`.

Version 4 requires Node `20` or `>=22`. The package has ESM/CommonJS conditional exports, and the documented public entry point is `jackspeak` (with `jackspeak/min` also published). The documented API does not require a separate jackspeak CLI or test runner.

## Core parsing shape

`jack(options = {})` returns a chainable `Jack`. The documented field-definition methods are:

- `heading(text, level?)`
- `description(text, { pre? } = {})`
- `flag(definitions)`
- `flagList(definitions)`
- `num(definitions)`
- `numList(definitions)`
- `opt(definitions)`
- `optList(definitions)`
- `addFields(...)`

Definitions are object literals. This is important for TypeScript inference and avoids the older assumption that the parser is configured with a separate schema format.

```ts pmcp-example
import { strict as assert } from 'node:assert'
import { jack } from 'jackspeak'

const parser = jack({ envPrefix: 'FOO' })
  .flag({
    foo: { description: 'another boolean', short: 'f' },
  })
  .optList({
    'ip-addrs': {
      description: 'addresses to ip things',
      delim: ',',
      default: ['127.0.0.1'],
    },
  })

const { positionals, values } = parser.parse([
  'some',
  'positional',
  '--ip-addrs',
  '192.168.0.1',
  '--ip-addrs',
  '1.1.1.1',
  '--foo',
])

assert.deepEqual(positionals, ['some', 'positional'])
assert.equal(values.foo, true)
assert.deepEqual(values['ip-addrs'], ['192.168.0.1', '1.1.1.1'])
```

Use `short` for a short flag or option name. A field can have a `description`, and list options can specify a delimiter and a default list.

## Field kinds

The available field kinds communicate the intended value shape:

- `flag`: boolean option
- `flagList`: repeated/list boolean option
- `opt`: scalar option
- `optList`: repeated/list option; `delim` controls delimiter splitting
- `num`: numeric option
- `numList`: repeated/list numeric option

The research documents the methods and the object-definition style, but does not document every individual field configuration or the exact result shape for every kind. Do not infer unsupported configuration names from examples for another major version.

```ts pmcp-example
import { strict as assert } from 'node:assert'
import { jack } from 'jackspeak'

const parser = jack()
  .flag({ verbose: { short: 'v' } })
  .opt({ reporter: { short: 'R', description: 'report style' } })
  .num({ jobs: { short: 'j', default: 1 } })

const parsed = parser.parse(['-v', '--reporter', 'compact', '--jobs', '4', 'file.ts'])

assert.equal(parsed.values.verbose, true)
assert.equal(parsed.values.reporter, 'compact')
assert.equal(parsed.values.jobs, 4)
assert.deepEqual(parsed.positionals, ['file.ts'])
```

## Validation and generated documentation

The parser exposes these actions:

- `parse(args?: string[])`: parse arguments and return `{ positionals, values }`.
- `validate(o)`: assert that an unknown value is a valid `OptionsResults` value. Invalid values throw.
- `usage()`: return usage text.
- `usageMarkdown()`: return usage documentation in Markdown.
- `setConfigValues(options, src?)`: set configuration values on the parser; `src` is optional.

Unrecognized configurations and invalid values throw. Keep validation at the boundary when values come from configuration rather than directly from `parse()`.

```ts pmcp-example
import { strict as assert } from 'node:assert'
import { jack } from 'jackspeak'

const parser = jack({ usage: 'foo [options] <files>' })
  .heading('The best Foo that ever Fooed')
  .description('Executes all the files.')
  .opt({ reporter: { short: 'R', description: 'report style' } })
  .num({ jobs: { short: 'j', default: 1 } })

const { values, positionals } = parser.parse(['--reporter', 'tap', 'a.ts'])
parser.validate(values)

assert.equal(values.reporter, 'tap')
assert.equal(values.jobs, 1)
assert.deepEqual(positionals, ['a.ts'])
assert.equal(typeof parser.usage(), 'string')
assert.equal(typeof parser.usageMarkdown(), 'string')
assert.match(parser.usage(), /foo/)
assert.match(parser.usageMarkdown(), /Foo|foo/)
```

## Headings, descriptions, and fields

`heading` accepts a text string and an optional heading level from 1 through 6. `description` accepts text and an optional `{ pre: boolean }` setting. Both participate in generated usage output. Field methods are chainable.

`addFields(...)` is also available for adding fields, but the opened research does not specify its argument shape; use the package's v4 type definitions or documentation when that method is required rather than copying a v3-era shape.

## Environment integration

Environment integration is conditional on `envPrefix`. The environment source defaults to `process.env`. Boolean values are represented as `'1'` and `'0'`; repeated values use a delimiter whose default is `\n`. The research does not establish a safe standalone example that changes the process environment, so rely on the v4 documentation and types for the exact field-to-environment naming rules.

## Common mistakes

- **Using the older runner-oriented mental model.** jackspeak is used programmatically here: import `jack`, define fields, and call `.parse()`. There is no documented separate jackspeak CLI for these examples.
- **Expecting `parse()` to return values directly.** It returns `{ positionals, values }`; read options from `result.values` and positional arguments from `result.positionals`.
- **Calling `.parse()` without accounting for `process.argv`.** The default is `process.argv`. Pass an explicit array when parsing supplied arguments or writing tests.
- **Assuming v3's runtime requirements.** v4 requires Node `20` or `>=22`; v3 had no `engines` field.
- **Assuming the optional parser dependency is required.** v4 lists `@pkgjs/parseargs` as an optional dependency; it is not required by the documented API.
- **Using undocumented configuration shapes.** Invalid or unrecognized configurations throw. In particular, do not invent the `addFields` argument shape or copy an older major's examples without checking v4's definitions.
- **Treating list options as scalar options.** Use `optList`/`numList`/`flagList` for list-shaped fields and configure `delim` where delimiter behavior matters.

## Not covered

This skill does not cover the complete v4 field-definition type signatures, every option supported by each field kind, exact long/short-option syntax beyond the documented examples, the exact environment-variable naming rules, the full behavior or argument shape of `addFields`, the `jackspeak/min` subpath API, CommonJS import examples, or the internal optional `@pkgjs/parseargs` integration. Those details were not established by the opened research.

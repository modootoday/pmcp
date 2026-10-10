---
name: ajv-formats
description: Use ajv-formats 3.x with Ajv 8 to add standard and OpenAPI format validation, fast/selective modes, direct format access, and format comparison keywords.
---

Verified against ajv-formats@3.0.1 on 2026-09-08. 5 of 5 examples executed.

# ajv-formats 3.x

`ajv-formats` is an Ajv plugin, not a standalone validator. Version 3 is for Ajv 7+ and declares Ajv 8 as both a dependency and peer dependency. The normal shape is still the same as older examples:

```ts
import Ajv from "ajv"
import addFormats from "ajv-formats"

const ajv = new Ajv()
addFormats(ajv)
```

Use the same Ajv installation/version for the application and `ajv-formats`.

## Add all formats

Calling `addFormats(ajv)` registers the package's formats with the Ajv instance. The documented formats include:

- `date`, `time`, `date-time`
- `iso-time`, `iso-date-time`
- `duration`
- `uri`, `uri-reference`, `uri-template`, deprecated `url`
- `email`, `hostname`, `ipv4`, `ipv6`, `regex`, `uuid`
- `json-pointer`, `json-pointer-uri-fragment`, `relative-json-pointer`
- OpenAPI formats: `byte`, `int32`, `int64`, `float`, `double`, `password`, `binary`

```ts pmcp-example
import assert from "node:assert/strict"
import Ajv from "ajv"
import addFormats from "ajv-formats"

const ajv = new Ajv()
addFormats(ajv)

const validate = ajv.compile({
  type: "object",
  properties: {
    birthday: { type: "string", format: "date" },
    email: { type: "string", format: "email" },
    ip: { type: "string", format: "ipv4" },
  },
  required: ["birthday", "email", "ip"],
  additionalProperties: false,
})

assert.equal(validate({ birthday: "2024-02-29", email: "a@example.com", ip: "192.0.2.1" }), true)
assert.equal(validate({ birthday: "2024-02-30", email: "a@example.com", ip: "192.0.2.1" }), false)
assert.equal(validate({ birthday: "2024-02-29", email: "not-an-email", ip: "192.0.2.1" }), false)
```

## Select formats and choose fast mode

The second argument can be a format-name array:

```ts
addFormats(ajv, ["date", "time"])
```

It can also be an options object. `mode` accepts `"fast"`; `formats` selects formats; and `keywords` controls the comparison keywords. The options form can combine these settings:

```ts pmcp-example
import assert from "node:assert/strict"
import Ajv from "ajv"
import addFormats from "ajv-formats"

const ajv = new Ajv()
addFormats(ajv, {
  mode: "fast",
  formats: ["date", "time"],
})

const validateDate = ajv.compile({ type: "string", format: "date" })

assert.equal(validateDate("2024-02-29"), true)
assert.equal(validateDate("not-a-date"), false)
// With Ajv's default strict schema handling, compiling an unregistered format fails.
assert.throws(
  () => ajv.compile({ type: "string", format: "email" }),
  /unknown format/i,
)
```

The `fast` mode is a validation mode, not a separate plugin or Ajv instance.

## v3 date and time behavior

In v3, `time` and `date-time` require a timezone. This differs from older v2 examples. Use `iso-time` and `iso-date-time` when the optional-timezone behavior is wanted.

```ts pmcp-example
import assert from "node:assert/strict"
import Ajv from "ajv"
import addFormats from "ajv-formats"

const ajv = new Ajv()
addFormats(ajv, ["time", "date-time", "iso-time", "iso-date-time"])

const time = ajv.compile({ type: "string", format: "time" })
const isoTime = ajv.compile({ type: "string", format: "iso-time" })
const dateTime = ajv.compile({ type: "string", format: "date-time" })
const isoDateTime = ajv.compile({ type: "string", format: "iso-date-time" })

assert.equal(time("12:30:00Z"), true)
assert.equal(time("12:30:00"), false)
assert.equal(isoTime("12:30:00"), true)

assert.equal(dateTime("2024-01-02T12:30:00Z"), true)
assert.equal(dateTime("2024-01-02T12:30:00"), false)
assert.equal(isoDateTime("2024-01-02T12:30:00"), true)
```

Comparisons for `time` and `date-time` account for timezone. The `iso-*` formats retain the timezone-ignoring comparison behavior.

## Format comparison keywords

Format comparison keywords are enabled by default in v3. They can also be enabled explicitly with `keywords: true`. They are `formatMinimum`, `formatMaximum`, `formatExclusiveMinimum`, and `formatExclusiveMaximum`, and apply only to strings.

```ts pmcp-example
import assert from "node:assert/strict"
import Ajv from "ajv"
import addFormats from "ajv-formats"

const ajv = new Ajv()
addFormats(ajv, { keywords: true })

const validate = ajv.compile({
  type: "string",
  format: "date",
  formatMinimum: "2024-01-01",
  formatExclusiveMaximum: "2024-12-31",
})

assert.equal(validate("2024-01-01"), true)
assert.equal(validate("2024-06-15"), true)
assert.equal(validate("2023-12-31"), false)
assert.equal(validate("2024-12-31"), false)
```

## Access a format directly

The plugin function exposes `get(format, mode?)`, including a mode-specific lookup:

```ts pmcp-example
import assert from "node:assert/strict"
import addFormats from "ajv-formats"

const dateFormat = addFormats.get("date")
const fastDateFormat = addFormats.get("date", "fast")

assert.ok(dateFormat)
assert.ok(fastDateFormat)
```

## Common mistakes

- Do not use an older v2 assumption that `time` or `date-time` may omit a timezone. Use `iso-time` or `iso-date-time` for that behavior.
- Do not call `formatMinimum` or related keywords without registering them; use the default plugin options or `{ keywords: true }`.
- Do not expect `ajv-formats` to validate by itself. Create an Ajv instance and install the plugin on it.
- Do not assume a selected-format call registers every format. An array or `formats` option limits registration to the listed names. With Ajv's default strict schema handling, compiling a schema using an unregistered format throws an unknown-format error.
- `url` is documented as deprecated; prefer the appropriate current format where possible.

## Not covered

This skill does not cover standalone generated validators, Ajv's generation step or CLI, the exact `Format` object shape returned by `get`, or detailed semantics for every individual listed format. Standalone output additionally requires Ajv `code.source: true` and matching Ajv code/import versions; it is exercised by the generation tool rather than by these direct scripts.

## Sources

- https://ajv.js.org/packages/ajv-formats.html
- https://github.com/ajv-validator/ajv-formats/blob/master/package.json?utm_source=openai
- https://raw.githubusercontent.com/ajv-validator/ajv-formats/v3.0.0/README.md
- https://github.com/ajv-validator/ajv-formats/releases?utm_source=openai
- https://ajv.js.org/guide/formats?utm_source=openai

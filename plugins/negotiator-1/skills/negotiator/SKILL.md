---
name: negotiator
description: Use negotiator 1.x to select preferred media types, languages, charsets, and encodings from request headers, including the 1.0.0 options-object form for preferred encoding order.
---

Verified against negotiator@1.1.0 on 2026-09-08. 4 of 4 examples executed.

# negotiator

`^1.0.0` targets the 1.x API. At the documented 1.0.0 baseline, the package drops support for Node versions older than 18 and accepts an options object for preferred encoding order.

## Loading and constructing

The package exports the `Negotiator` constructor as the default CommonJS export and as `.Negotiator`:

```js
var Negotiator = require('negotiator')
```

Construct it with a request-shaped object containing `headers`. The package reads headers from that object; it does not obtain an HTTP request or headers itself.

```js
var negotiator = new Negotiator({
  headers: {
    accept: 'text/html'
  }
})
```

The constructor can also be called without `new`, but using `new` is the documented form.

## Media-type negotiation

Methods:

- `mediaTypes()` returns the client’s preferred media types.
- `mediaTypes(availableMediaTypes)` filters and orders a supplied list.
- `mediaType(availableMediaTypes)` returns the single best match.
- `mediaType()` is the corresponding single-result form without an available list.

```ts pmcp-example
import assert from 'node:assert/strict'
import Negotiator from 'negotiator'

const negotiator = new Negotiator({
  headers: {
    accept: 'text/html, application/json;q=0.8'
  }
})

assert.deepEqual(negotiator.mediaTypes(), ['text/html', 'application/json'])
assert.deepEqual(
  negotiator.mediaTypes(['application/json', 'text/plain', 'text/html']),
  ['text/html', 'application/json']
)
assert.equal(
  negotiator.mediaType(['application/json', 'text/plain', 'text/html']),
  'text/html'
)
assert.equal(negotiator.mediaType(), 'text/html')
```

## Language negotiation

Methods:

- `languages()` returns the preferred languages.
- `languages(availableLanguages)` filters and orders a supplied list.
- `language(availableLanguages)` returns the best available language.
- `language()` is the corresponding single-result form without an available list.

```ts pmcp-example
import assert from 'node:assert/strict'
import Negotiator from 'negotiator'

const negotiator = new Negotiator({
  headers: {
    'accept-language': 'es, pt;q=0.8, en;q=0.7'
  }
})

assert.deepEqual(negotiator.languages(), ['es', 'pt', 'en'])
assert.deepEqual(
  negotiator.languages(['en', 'es', 'fr']),
  ['es', 'en']
)
assert.equal(negotiator.language(['en', 'es', 'fr']), 'es')
assert.equal(negotiator.language(), 'es')
```

## Charset negotiation

Methods:

- `charsets()` returns preferred character sets.
- `charsets(availableCharsets)` filters and orders a supplied list.
- `charset(availableCharsets)` returns the best available character set.
- `charset()` is the corresponding single-result form without an available list.

```ts pmcp-example
import assert from 'node:assert/strict'
import Negotiator from 'negotiator'

const negotiator = new Negotiator({
  headers: {
    'accept-charset': 'utf-8, iso-8859-1;q=0.5'
  }
})

assert.deepEqual(negotiator.charsets(), ['utf-8', 'iso-8859-1'])
assert.deepEqual(
  negotiator.charsets(['iso-8859-1', 'utf-8']),
  ['utf-8', 'iso-8859-1']
)
assert.equal(negotiator.charset(['iso-8859-1', 'utf-8']), 'utf-8')
assert.equal(negotiator.charset(), 'utf-8')
```

## Encoding negotiation

Methods:

- `encodings()` returns preferred content encodings.
- `encodings(availableEncodings)` filters and orders a supplied list.
- `encoding(availableEncodings)` returns the best available encoding.
- `encoding()` is the corresponding single-result form without an available list.
- `encoding(availableEncodings, { preferred })` and `encodings(availableEncodings, { preferred })` use the supplied `preferred` array to prioritize encodings with the same quality.

In 1.0.0, the preferred order is an options property, not a second positional array argument. The older 0.6.4 shape was `encoding(availableEncodings, preferred)` / `encodings(availableEncodings, preferred)`; do not carry that shape forward.

```ts pmcp-example
import assert from 'node:assert/strict'
import Negotiator from 'negotiator'

const negotiator = new Negotiator({
  headers: {
    'accept-encoding': 'gzip;q=1, br;q=1, identity;q=0.5'
  }
})

assert.deepEqual(negotiator.encodings(), ['gzip', 'br', 'identity'])
assert.deepEqual(
  negotiator.encodings(['br', 'gzip', 'identity']),
  ['gzip', 'br', 'identity']
)
assert.equal(negotiator.encoding(['br', 'gzip', 'identity']), 'gzip')
assert.deepEqual(
  negotiator.encodings(['br', 'gzip'], { preferred: ['br', 'gzip'] }),
  ['br', 'gzip']
)
assert.equal(
  negotiator.encoding(['br', 'gzip'], { preferred: ['br', 'gzip'] }),
  'br'
)
```

## Backward-compatible aliases

The following aliases remain available:

- `preferredCharset` → `charset`
- `preferredCharsets` → `charsets`
- `preferredEncoding` → `encoding`
- `preferredEncodings` → `encodings`
- `preferredLanguage` → `language`
- `preferredLanguages` → `languages`
- `preferredMediaType` → `mediaType`
- `preferredMediaTypes` → `mediaTypes`

Use the canonical names in new code; aliases are useful when maintaining code written against the older naming scheme.

## What this skill does not cover

This skill does not cover HTTP server integration, framework adapters, CLI usage, installation commands, detailed wildcard and quality-factor edge cases, missing-header behavior, or behavior outside the documented 1.x API. The package is exercised directly with a caller-supplied request object; the research does not document a runner, CLI, or build step.

Sources:

- https://github.com/jshttp/negotiator/tree/v1.0.0
- https://raw.githubusercontent.com/jshttp/negotiator/v1.0.0/README.md
- https://raw.githubusercontent.com/jshttp/negotiator/v1.0.0/HISTORY.md

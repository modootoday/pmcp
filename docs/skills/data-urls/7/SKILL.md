---
name: data-urls
description: Parse WHATWG data: URLs with data-urls@^7.0.0, including MIME types, byte bodies, invalid input, base64 payloads, and URL-record parsing.
---

Verified against data-urls@7.0.0 on 2026-09-08. 6 of 6 examples executed.

# data-urls

Use this skill for `data-urls@^7.0.0`.

## Surface

The default export is callable:

```js
const parseDataURL = require("data-urls");
const result = parseDataURL(input);
```

It returns either:

- `{ mimeType, body }`, where `mimeType` is a `whatwg-mimetype` `MIMEType` and `body` is a `Uint8Array`.
- `null` when the input cannot be parsed as a `data:` URL.

The named `fromURLRecord` export accepts a `whatwg-url` URL record:

```js
const { fromURLRecord } = require("data-urls");
const { parseURL } = require("whatwg-url");
const result = fromURLRecord(parseURL("data:,Hello"));
```

## Important version differences

- In v7, the main export is directly callable and returns `{ mimeType, body }` or `null`. Do not use an older API shape from examples that returns or requires a different parser object.
- The runtime floor declared by v7 is `^20.19.0 || ^22.12.0 || >=24.0.0`.
- The v7 dependency generations are `whatwg-mimetype` `^5.0.0` and `whatwg-url` `^16.0.0`.
- For decoding the returned bytes, v7 documents `TextDecoder`. Older examples using `whatwg-encoding` are not the documented v7 approach.

## Parse ordinary text data URLs

A missing media type receives the MIME type shown below. Percent escapes in the payload are decoded into bytes.

```ts pmcp-example
import assert from "node:assert/strict";
import parseDataURL from "data-urls";

const result = parseDataURL("data:,Hello%2C%20World!");

assert.notEqual(result, null);
assert.equal(result.mimeType.toString(), "text/plain;charset=US-ASCII");
assert.deepEqual([...result.body], [...new TextEncoder().encode("Hello, World!")]);
```

A declared MIME type is preserved in the returned MIMEType object.

```ts pmcp-example
import assert from "node:assert/strict";
import parseDataURL from "data-urls";

const result = parseDataURL("data:text/html,%3Ch1%3EHello%2C%20World!%3C%2Fh1%3E");

assert.notEqual(result, null);
assert.equal(result.mimeType.toString(), "text/html");
assert.equal(new TextDecoder().decode(result.body), "<h1>Hello, World!</h1>");
```

## Parse base64 data URLs

Use the `;base64` marker in the metadata portion. The result body remains a `Uint8Array`.

```ts pmcp-example
import assert from "node:assert/strict";
import parseDataURL from "data-urls";

const result = parseDataURL(
  "data:image/png;base64,iVBORw0KGgoAAA" +
  "ANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4" +
  "//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU" +
  "5ErkJggg=="
);

assert.notEqual(result, null);
assert.equal(result.mimeType.toString(), "image/png");
assert.ok(result.body instanceof Uint8Array);
assert.deepEqual([...result.body.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
assert.equal(result.body.length, 85);
```

## Handle invalid input

Check for `null` before accessing `mimeType` or `body`.

```ts pmcp-example
import assert from "node:assert/strict";
import parseDataURL from "data-urls";

assert.equal(parseDataURL("https://example.com/resource"), null);
assert.equal(parseDataURL("not a URL"), null);
```

## Parse from a URL record

Use `fromURLRecord` when the caller already has a `whatwg-url` URL record. A string should be passed to the default export instead.

```ts pmcp-example
import assert from "node:assert/strict";
import dataURLs from "data-urls";
import { parseURL } from "whatwg-url";

const urlRecord = parseURL("data:,Hello%2C%20World!");
assert.notEqual(urlRecord, null);

const result = dataURLs.fromURLRecord(urlRecord);
assert.notEqual(result, null);
assert.equal(result.mimeType.toString(), "text/plain;charset=US-ASCII");
assert.equal(new TextDecoder().decode(result.body), "Hello, World!");
```

## Decode bytes as text

Parsing returns bytes, not a JavaScript string. Use `TextDecoder` when text decoding is needed. The package documentation suggests `@exodus/bytes` as a `TextDecoder` polyfill when required.

```ts pmcp-example
import assert from "node:assert/strict";
import parseDataURL from "data-urls";

const result = parseDataURL("data:text/plain;charset=utf-8,Hello%20world");
assert.notEqual(result, null);
assert.equal(new TextDecoder().decode(result.body), "Hello world");
```

## What this skill does not cover

This skill does not cover the internal WHATWG parsing algorithm, the complete `MIMEType` API, the complete `whatwg-url` URL-record API, runtime polyfill setup, or any CLI/tool workflow. The research describes no package-owned consumer CLI; the documented parser exports are used directly from a script.

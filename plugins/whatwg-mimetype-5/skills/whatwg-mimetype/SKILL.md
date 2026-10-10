---
name: whatwg-mimetype
description: Use whatwg-mimetype ^5.0.0 to parse, inspect, mutate, serialize, classify, and compute MIME types from resource bytes.
---

Verified against whatwg-mimetype@5.0.0 on 2026-09-08. 6 of 6 examples executed.

# whatwg-mimetype

## Scope and version

This skill targets `whatwg-mimetype` `^5.0.0`, which requires Node.js `>=20`.
The package root exports exactly the named APIs `MIMEType` and `computedMIMEType`.

In v5, `MIMEType` is a named export rather than the older default-export shape. Raw parsing and serialization APIs from older versions were removed.

## Parsing and serialization

Constructing a MIME type parses the string and throws an `Error` if parsing fails. `MIMEType.parse(string)` performs the same kind of parsing but returns `null` on failure.

A parsed instance exposes:

- mutable `type`
- mutable `subtype`
- getter-only `essence`, which is `type/subtype`
- mutable `parameters`
- `toString()` for serialization

Parsing and serialization normalize the type, subtype, and parameter names according to the MIME type rules. Parameter values are not generally lowercased: for example, a parameter value of `D` remains `D`, while a quoted value such as `"utf-8"` is serialized without unnecessary quotes.

```ts pmcp-example
import assert from "node:assert/strict";
import { MIMEType } from "whatwg-mimetype";

const mimeType = new MIMEType('Text/HTML;Charset="utf-8"');

assert.equal(mimeType.toString(), "text/html;charset=utf-8");
assert.equal(mimeType.type, "text");
assert.equal(mimeType.subtype, "html");
assert.equal(mimeType.essence, "text/html");
assert.equal(mimeType.parameters.get("charset"), "utf-8");

assert.equal(MIMEType.parse("not a MIME type"), null);
assert.throws(() => new MIMEType("not a MIME type"), Error);
```

Do not use the v4-style default import. Use the v5 named import:

```ts pmcp-example
import assert from "node:assert/strict";
import { MIMEType } from "whatwg-mimetype";

const mimeType = new MIMEType("text/plain");
mimeType.type = "application";
mimeType.subtype = "json";

assert.equal(mimeType.essence, "application/json");
assert.equal(mimeType.toString(), "application/json");
```

`type` and `subtype` are validated when changed. `essence` is getter-only; update `type` or `subtype` instead of assigning to `essence`.

## Parameters

`mimeType.parameters` is a MIME-specific Map-like object, not a package-root `MIMETypeParameters` export. Parameter names are handled case-insensitively and normalized to lowercase. Parameter values preserve their parsed spelling. It supports the documented `get`, `set`, and iteration usage.

```ts pmcp-example
import assert from "node:assert/strict";
import { MIMEType } from "whatwg-mimetype";

const mimeType = new MIMEType("x/x;a=b;c=D;E=\"F\"");

const entries = [...mimeType.parameters];
assert.deepEqual(entries, [
  ["a", "b"],
  ["c", "D"],
  ["e", "F"],
]);

mimeType.parameters.set("Q", "X");
assert.equal(mimeType.parameters.get("q"), "X");
assert.equal(mimeType.toString(), "x/x;a=b;c=D;e=F;q=X");
```

## Classification helpers

`MIMEType` provides `isHTML()`, `isXML()`, and `isJavaScript({ prohibitParameters })`. These helpers are documented as speculative and may change in a future major; avoid treating them as a permanently stable compatibility contract.

```ts pmcp-example
import assert from "node:assert/strict";
import { MIMEType } from "whatwg-mimetype";

const html = new MIMEType('Text/HTML;Charset="utf-8"');
assert.equal(html.isHTML(), true);
assert.equal(html.isXML(), false);

const xml = new MIMEType("application/xml");
assert.equal(xml.isXML(), true);

const javascript = new MIMEType("text/javascript");
assert.equal(javascript.isJavaScript({ prohibitParameters: false }), true);
```

## Computing a MIME type from bytes

`computedMIMEType(resource, options)` is a plain library API. `resource` must be a `Uint8Array`; the result is a `MIMEType`.

Supported options are `contentTypeHeader`, `providedType`, `noSniff` (default `false`), and `isSupported` (default `() => true`). The function can sniff resource bytes. A PNG signature is computed as `image/png` without a header. An `image/gif` content-type header does not override that PNG result, while a `text/html` header does produce `text/html` in the documented example.

```ts pmcp-example
import assert from "node:assert/strict";
import { computedMIMEType, MIMEType } from "whatwg-mimetype";

const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47,
  0x0d, 0x0a, 0x1a, 0x0a,
]);

assert.equal(computedMIMEType(pngBytes).essence, "image/png");
assert.equal(
  computedMIMEType(pngBytes, { contentTypeHeader: "image/gif" }).essence,
  "image/png",
);
assert.equal(
  computedMIMEType(pngBytes, { contentTypeHeader: "text/html" }).essence,
  "text/html",
);
assert.ok(computedMIMEType(pngBytes) instanceof MIMEType);
```

The options are passed to the computation as an options object; do not pass a string as the second argument.

```ts pmcp-example
import assert from "node:assert/strict";
import { computedMIMEType, MIMEType } from "whatwg-mimetype";

const resource = new Uint8Array();
const result = computedMIMEType(resource, {
  contentTypeHeader: "text/plain",
  providedType: "text/plain",
  noSniff: false,
  isSupported: () => true,
});

assert.ok(result instanceof MIMEType);
```

## What this skill does not cover

This skill does not cover MIME sniffing cases beyond the documented PNG examples, the detailed validation rules for every possible type or parameter value, or the exact behavior of each `computedMIMEType` option combination. It also does not cover removed v4 raw parsing/serialization APIs, package development scripts, or any runner, CLI, build step, or framework integration; the package exposes a plain programmatic API instead.

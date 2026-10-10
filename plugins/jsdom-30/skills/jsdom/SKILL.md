---
name: jsdom
description: Use jsdom ^30.0.0 from a plain Bun/Node script to construct and inspect DOMs and create document fragments. The documented v30 package requires Node.js ^22.22.2 || ^24.15.0 || >=26.0.0.
---

Verified against jsdom@30.0.1 on 2026-09-07. 2 of 2 examples executed.

# jsdom ^30.0.0

## Runtime requirement

The v30 release requires Node.js `^22.22.2 || ^24.15.0 || >=26.0.0`.

## Construct and query a DOM

Import the named `JSDOM` export. The constructor accepts an HTML string and returns an object whose DOM is available through `dom.window.document`.

```ts pmcp-example
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!DOCTYPE html><p>Hello world</p>");

assert.equal(dom.window.document.querySelector("p")?.textContent, "Hello world");
```

A common shape mistake is treating the constructor result as the document itself. Query through `dom.window.document`, not directly through `dom`.

## Document fragments

`JSDOM.fragment()` creates a document fragment from markup without requiring a full `JSDOM` window.

```ts pmcp-example
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const fragment = JSDOM.fragment("<p>One</p><p>Two</p>");

assert.equal(fragment.querySelectorAll("p").length, 2);
assert.equal(fragment.querySelector("p")?.textContent, "One");
```

## Inline scripts

Scripts are disabled by default. The documented constructor option for enabling inline script execution is `{ runScripts: "dangerously" }`.

No standalone runnable example is included for this option: when executed as the required direct Bun script, the documented inline-script example failed before running the script with `TypeError: Proxy is not allowed in the global prototype chain.` Use this feature only in a runtime where jsdom v30's script execution works, and only with trusted HTML.

## Other documented exports and factories

The README also documents or demonstrates:

- `JSDOM.fromURL()` for creating a DOM from a URL.
- `JSDOM.fromFile()` for creating a DOM from a file.
- `VirtualConsole`.
- `CookieJar`.
- `requestInterceptor`.
- The `toughCookie` module export.

`fromURL()` requires network access and `fromFile()` requires a file, so neither is used in the isolated examples here. The available research does not provide enough detail to specify their options or behavior safely.

## What this skill does not cover

This skill does not cover URL loading, file loading, virtual-console configuration, cookie-jar usage, request interception, the `toughCookie` export, DOM APIs beyond the demonstrated construction and fragment querying, or configuration beyond the documented `runScripts` setting. It also does not cover a working standalone example of inline script execution under Bun, or using jsdom through a test runner or framework.

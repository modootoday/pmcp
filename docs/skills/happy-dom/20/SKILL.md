---
name: happy-dom
description: Use happy-dom ^20.0.0 as a headless DOM/browser implementation in standalone Bun or Node scripts, with v20 security defaults and lifecycle cleanup in mind.
---

Verified against happy-dom@20.14.0 on 2026-09-07. 5 of 5 examples executed.

# happy-dom

## Scope

`happy-dom` provides a headless DOM implementation and a programmatic browser API. The examples below are standalone scripts: each can be run as `bun example.ts` with only `happy-dom` installed.

## `Window`: create and manipulate a DOM

Import `Window` from `happy-dom`. Pass a URL when code under test depends on the document location. Access the DOM through `window.document`.

```ts pmcp-example
import { strict as assert } from 'node:assert';
import { Window } from 'happy-dom';

const window = new Window({ url: 'https://localhost:8080' });
const document = window.document;

document.body.innerHTML = '<div class="container"></div>';
const container = document.querySelector('.container');
assert.ok(container);

const button = document.createElement('button');
container.appendChild(button);

assert.equal(document.body.innerHTML, '<div class="container"><button></button></div>');
assert.equal(window.location.href, 'https://localhost:8080/');

await window.happyDOM.abort();
window.close();
```

Use `window.happyDOM.abort()` when pending Happy DOM work should be stopped, and call `window.close()` when the window is no longer needed.

## JavaScript evaluation is disabled by default in v20

Do not assume that scripts embedded in markup execute. Since v20, JavaScript evaluation is disabled by default for security reasons. Enable it explicitly with `settings: { enableJavaScriptEvaluation: true }` only when the evaluated code is trusted. A VM context is not an isolation boundary; untrusted JavaScript can pose an RCE risk.

```ts pmcp-example
import { strict as assert } from 'node:assert';
import { Window } from 'happy-dom';

const window = new Window({
  settings: { enableJavaScriptEvaluation: true }
});

window.document.write(`
  <script>
    document.body.setAttribute('data-evaluated', 'yes');
  </script>
`);

assert.equal(window.document.body.getAttribute('data-evaluated'), 'yes');

await window.happyDOM.abort();
window.close();
```

A common outdated pattern is to rely on HTML scripts executing without this setting. In v20 that default is intentionally off.

## `Browser` and pages

Import `Browser` and, when configuring error handling, `BrowserErrorCaptureEnum`. Create a page with `browser.newPage()`, navigate with `page.goto()`, use `page.mainFrame.document`, and wait with `page.waitUntilComplete()`.

The documented browser flow navigates to a URL and therefore requires the browser's page-loading environment. The standalone example below only exercises the constructible, offline portion of the API and does not make a network request.

```ts pmcp-example
import { strict as assert } from 'node:assert';
import { Browser, BrowserErrorCaptureEnum } from 'happy-dom';

const browser = new Browser({
  settings: { errorCapture: BrowserErrorCaptureEnum.processLevel }
});

const page = browser.newPage();
assert.ok(page);
assert.ok(page.mainFrame);
assert.ok(page.mainFrame.document);

await page.waitUntilComplete();
await browser.close();
```

For a loaded page, the documented sequence is:

```ts
const browser = new Browser({
  settings: { errorCapture: BrowserErrorCaptureEnum.processLevel }
});
const page = browser.newPage();
await page.goto('https://example.test/');
page.mainFrame.document.querySelector('a')?.click();
await page.waitUntilComplete();
await browser.close();
```

Always close the browser when finished. The browser/page API is not the same shape as the older examples that only construct a `Window`.

## `GlobalWindow`

`GlobalWindow` extends `Window` but evaluates document scripts in the global scope rather than in a Node.js VM context. This changes global state, so use it only when that behavior is required. Enable JavaScript evaluation explicitly in v20.

```ts pmcp-example
import { strict as assert } from 'node:assert';
import { GlobalWindow } from 'happy-dom';

const key = '__happyDomSkillExampleValue';
const window = new GlobalWindow({
  settings: { enableJavaScriptEvaluation: true }
});

window.document.write(`
  <script>
    globalThis.${key} = 'Hello world!';
  </script>
`);

assert.equal((globalThis as Record<string, unknown>)[key], 'Hello world!');
delete (globalThis as Record<string, unknown>)[key];

await window.happyDOM.close();
```

The older `GlobalWindow` example shape that expects scripts to run without an explicit setting is not appropriate for v20.

## Finding the owning window with `PropertySymbol`

`PropertySymbol` exposes the internal symbol used to retrieve the Happy DOM window associated with a document. Current code uses `PropertySymbol.window`; the setup documentation also shows an older `PropertySymbol.ownerWindow` name, so use the fallback when supporting both shapes.

```ts pmcp-example
import { strict as assert } from 'node:assert';
import { PropertySymbol, Window } from 'happy-dom';

const window = new Window();
const document = window.document as typeof window.document & {
  [PropertySymbol.ownerWindow]?: Window;
  [PropertySymbol.window]?: Window;
};

const owningWindow =
  document[PropertySymbol.ownerWindow] || document[PropertySymbol.window];

assert.equal(owningWindow, window);

await window.happyDOM.abort();
window.close();
```

## Test-environment integrations are separate

Happy DOM can be used by test tools, but those integrations are not needed for the standalone `Window` and `Browser` APIs:

- Jest requires the separate `@happy-dom/jest-environment` package.
- Node's native test runner requires `@happy-dom/global-registrator` to be imported before tests.
- Global DOM globals require `@happy-dom/global-registrator`, for example `GlobalRegistrator.register({ url: 'http://localhost:3000' })`.
- In Vitest, the documented timer workaround replaces the host timer functions with the window's timer functions. The relevant window is obtained through `PropertySymbol.ownerWindow` or the current `PropertySymbol.window` fallback.

Do not copy runner globals such as `describe`, `it`, or `expect` into a direct Bun script; they are not provided by `happy-dom`.

## Server rendering is a separate package

SSR/SSG command-line rendering belongs to `@happy-dom/server-renderer`, not the `happy-dom` package itself. Its command-line JavaScript option is separate from the programmatic `Window` setting. The server renderer keeps JavaScript disabled by default and enables it with its `--javascript` option.

## Not covered

This skill does not cover the complete DOM API, browser navigation and network behavior, every browser/page lifecycle method, Vitest/Jest configuration, the `@happy-dom/global-registrator` package API, or `@happy-dom/server-renderer` usage beyond identifying that these are separate integrations. It also does not establish a security boundary for evaluated JavaScript.

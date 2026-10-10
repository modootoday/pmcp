---
name: playwright-test
description: Use @playwright/test 1.x correctly: distinguish its runner-managed test API from standalone imports, configure projects, define fixtures, and compose test/assertion extensions.
---

Verified against @playwright/test@1.63.0 on 2026-09-07. 5 of 5 examples executed.

# @playwright/test

## Scope and package shape

`@playwright/test` is the Playwright Test runner package. The `^1.0.0` range stays within the 1.x major; the researched npm entry currently shows `1.63.0`.

The package entry point re-exports `playwright/test` and its default export. The main authoring surface is:

```ts
import { test, expect } from '@playwright/test';
```

`test(title, body)` and `test(title, details, body)` declare tests. `expect(value)` provides generic assertions and web-first asynchronous assertions.

Tests are normally executed by the Playwright runner:

```sh
npm i -D @playwright/test
npx playwright test
```

The runner supplies fixtures such as `{ page }`, handles isolation, retries, workers, and reporters, and consumes configuration. A fixture argument is not created merely by calling a test function in an ordinary script.

## The common shape mistake

Do not translate older Puppeteer or Jest-style code directly into this package. The older pattern manually launches a browser, creates a page, uses `describe`/`it`, and manages lifecycle with hooks. The Playwright Test shape imports `test` and `expect`, and receives an isolated fixture from the runner:

```ts
import { test, expect } from '@playwright/test';

test('basic test', async ({ page }) => {
  await page.goto('https://playwright.dev/');
  await expect(page).toHaveTitle(/Playwright/);
});
```

`describe`, `it`, `beforeAll`, and `afterAll` are not globals supplied to a file run directly with Bun. Do not write a standalone script that expects Playwright Test to inject `{ page }`; put that code in a spec and run it with `npx playwright test`.

The package is runner-oriented rather than a general standalone browser-automation API. For direct browser automation, the researched alternative is the separate Playwright Library surface, such as `playwright.chromium.launch()`.

## Plain-script surface

The following examples are deliberately runnable as independent files with `bun example.ts`. They do not start the test runner, launch a browser, use the network, or require a config file.

### Generic `expect`

`expect` can be used for ordinary synchronous assertions without a runner.

```ts pmcp-example
import { expect } from '@playwright/test';

const value = { status: 'ready', count: 2 };
expect(value.status).toBe('ready');
expect(value.count).toBeGreaterThan(1);
expect(value).toEqual({ status: 'ready', count: 2 });
```

### Configuration with `defineConfig`

`defineConfig` returns configuration for the Playwright runner. It does not execute the runner in a plain script.

```ts pmcp-example
import { strict as assert } from 'node:assert';
import { defineConfig } from '@playwright/test';

const config = defineConfig({ fullyParallel: true });
assert.equal(config.fullyParallel, true);
```

### Device descriptors

`devices` supplies device descriptors for project configuration. The descriptor can be inspected without launching a browser.

```ts pmcp-example
import { strict as assert } from 'node:assert';
import { devices } from '@playwright/test';

const desktopChrome = devices['Desktop Chrome'];
assert.ok(desktopChrome);
assert.equal(typeof desktopChrome, 'object');
```

### Custom fixtures with `test.extend`

`test.extend()` creates a test object with custom fixtures. The fixture callback is consumed when the Playwright runner executes a test; creating the extended test object itself is safe in a plain script.

```ts pmcp-example
import { strict as assert } from 'node:assert';
import { test as base } from '@playwright/test';

const customTest = base.extend<{ account: { username: string } }>({
  account: async ({}, use) => {
    await use({ username: 'user' });
  },
});

assert.equal(typeof customTest, 'function');
assert.equal(typeof customTest.extend, 'function');
```

A normal fixture-backed spec exports or uses this extended test with the runner:

```ts
import { test as base, expect } from '@playwright/test';

export const test = base.extend<{ account: { username: string } }>({
  account: async ({}, use) => {
    await use({ username: 'user' });
  },
});

export { expect } from '@playwright/test';
```

Built-in fixtures documented by the research include `page`, `context`, `browser`, `browserName`, `request`, and `mount`. Their values are prepared by Playwright Test rather than by a direct script.

### Combining test and assertion extensions

`mergeTests` combines fixture-bearing test objects, while `mergeExpects` combines assertion libraries. These are composition helpers for runner-oriented test modules.

```ts pmcp-example
import { strict as assert } from 'node:assert';
import { mergeTests, mergeExpects, test as base, expect as baseExpect } from '@playwright/test';

const mergedTest = mergeTests(base, base);
const mergedExpect = mergeExpects(baseExpect, baseExpect);

assert.equal(typeof mergedTest, 'function');
assert.equal(typeof mergedExpect, 'function');
```

## Runner-only operations

Use a Playwright spec and invoke the runner for:

- Tests that receive fixtures such as `{ page }`.
- Browser navigation and web-first assertions involving a page.
- Fixture setup and teardown.
- Retries, workers, isolation, reporters, and `test.use()`.
- Configuration supplied through `defineConfig`.

The runner can also be invoked with `npx playwright test --ui`, and its report can be displayed with `npx playwright show-report`.

## What this skill does not cover

This skill does not cover the complete `test` API, every matcher, browser-launching details, locator usage, request APIs, fixture lifecycle details, configuration options beyond the researched examples, CLI flags beyond those shown, reporter configuration, or the separate `playwright` library API. It also does not provide a standalone replacement for the Playwright Test runner; runner-managed tests must be exercised by the tool itself.

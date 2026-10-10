---
name: allure-js-commons
description: Use allure-js-commons 3.x as the test-facing Allure facade or as the SDK foundation for a framework adapter. Prefer the v3 ReporterRuntime/TestRuntime architecture over the removed v2 AllureRuntime shape.
---

Verified against allure-js-commons@3.12.0 on 2026-09-08. 4 of 4 examples executed.

# allure-js-commons 3.x

## Scope

`allure-js-commons` is a shared runtime API and reporter SDK. It does not execute tests or render HTML. A framework adapter must produce `allure-results`; Allure Report then generates or opens the report.

The package has two distinct surfaces:

- The root package is the test-facing facade: metadata, parameters, steps, logs, and attachments.
- `allure-js-commons/sdk` and its subpaths are for framework integrations and custom reporters.

## Test-facing facade

Import the asynchronous facade from the package root:

```ts pmcp-example
import assert from "node:assert/strict";
import * as allure from "allure-js-commons";

assert.equal(typeof allure.epic, "function");
assert.equal(typeof allure.feature, "function");
assert.equal(typeof allure.story, "function");
assert.equal(typeof allure.owner, "function");
assert.equal(typeof allure.severity, "function");
assert.equal(typeof allure.issue, "function");
assert.equal(typeof allure.tms, "function");
assert.equal(typeof allure.tag, "function");
assert.equal(typeof allure.description, "function");
assert.equal(typeof allure.descriptionHtml, "function");
assert.equal(typeof allure.displayName, "function");
assert.equal(typeof allure.historyId, "function");
assert.equal(typeof allure.testCaseId, "function");
assert.equal(typeof allure.parameter, "function");
assert.equal(typeof allure.step, "function");
assert.equal(typeof allure.logStep, "function");
assert.equal(typeof allure.attachment, "function");
assert.equal(typeof allure.attachmentPath, "function");
assert.equal(typeof allure.globalAttachment, "function");
assert.equal(typeof allure.globalAttachmentPath, "function");
```

Typical calls are asynchronous:

```ts pmcp-example
import assert from "node:assert/strict";
import * as allure from "allure-js-commons";

assert.equal(typeof allure.step, "function");

// These calls are meaningful when a framework integration has registered
// the active runtime with setGlobalTestRuntime().
await allure.epic("Authentication");
await allure.feature("Password sign-in");
await allure.owner("qa-team");
await allure.parameter("browser", "chromium");

await allure.step("Submit valid credentials", async () => {
  await allure.attachment(
    "request",
    JSON.stringify({ login: "jane" }),
    { contentType: "application/json" },
  );
});
```

Without an integration setup, facade calls warn and have no reporting effect. For Node's test runner, the documented integration setup uses `--import allure-node-test/setup`; the reporter is selected with `--test-reporter allure-node-test/reporter`.

### Synchronous facade

Use `allure-js-commons/sync` for synchronous integrations:

```ts pmcp-example
import assert from "node:assert/strict";
import * as allure from "allure-js-commons/sync";

assert.equal(typeof allure.epic, "function");
assert.equal(typeof allure.parameter, "function");
assert.equal(typeof allure.step, "function");

allure.epic("Authentication");
allure.parameter("browser", "chromium");
allure.step("Submit valid credentials", () => {
  allure.attachment(
    "request",
    JSON.stringify({ login: "jane" }),
    { contentType: "application/json" },
  );
});
```

The callback passed to synchronous `step()` must be strictly synchronous and must not return a `Promise`. Do not use an `async` callback with this facade.

## Custom integrations and reporter SDK

Version 3 split the old runtime into client/facade code and an SDK. The v3 integration names are `ReporterRuntime` and `TestRuntime`; the old `AllureRuntime` shape belongs to v2-era code.

The SDK surface includes:

- `ReporterRuntime`
- `createDefaultWriter`
- `FileSystemWriter`
- `InMemoryWriter`
- `MessageWriter`
- `MessageReader`
- `setGlobalTestRuntime`
- `MessageTestRuntime`
- `MessageHolderTestRuntime`
- `createTestResult`
- `createStepResult`
- `createFixtureResult`
- `createTestResultContainer`

The reporter classes are imported from `allure-js-commons/sdk/reporter`; runtime classes are imported from `allure-js-commons/sdk/runtime`. `RuntimeMessage` is a type from `allure-js-commons/sdk`.

```ts pmcp-example
import assert from "node:assert/strict";
import { ReporterRuntime, InMemoryWriter } from "allure-js-commons/sdk/reporter";
import {
  MessageTestRuntime,
  MessageHolderTestRuntime,
  setGlobalTestRuntime,
} from "allure-js-commons/sdk/runtime";

assert.equal(typeof ReporterRuntime, "function");
assert.equal(typeof InMemoryWriter, "function");
assert.equal(typeof MessageTestRuntime, "function");
assert.equal(typeof MessageHolderTestRuntime, "function");
assert.equal(typeof setGlobalTestRuntime, "function");
```

A custom adapter creates a `ReporterRuntime` with a writer, registers a test runtime with `setGlobalTestRuntime()`, maps framework lifecycle events to `startTest`, `updateTest`, `stopTest`, and `writeTest`, and forwards runtime messages to `ReporterRuntime.applyRuntimeMessages()`.

A representative reporter construction is:

```ts
import { ReporterRuntime, FileSystemWriter } from "allure-js-commons/sdk/reporter";

const reporterRuntime = new ReporterRuntime({
  writer: new FileSystemWriter({ resultsDir: ".out/allure-results" }),
});
```

Use `createDefaultWriter({ resultsDir: "./allure-results" })` when the integration wants the package's default writer selection. Use `InMemoryWriter` when the adapter needs an in-memory writer. The exact framework lifecycle mapping remains the adapter's responsibility.

## Migration traps from v2

Do not carry this older custom-integration shape into 3.x:

```ts
const runtime = new AllureRuntime({ resultsDir: "./allure-results" });
```

In v3, use `ReporterRuntime` plus a writer, and connect the framework-side `TestRuntime` through `setGlobalTestRuntime()`.

Also do not rely on old root exports such as `ExecutableItem` or `FileSystemAllureWriter`; v3 no longer exports those names from the package root.

The root facade's test-facing usage did not become the SDK integration API. Keep calls such as `allure.step()` in framework tests, and use the SDK subpaths when implementing a framework adapter.

## What this skill does not cover

- The complete `ReporterRuntime` lifecycle method signatures or message schemas.
- How to implement a particular framework adapter.
- The full behavior or constructor options of every writer, reader, result factory, or runtime class.
- Allure Report generation or HTML rendering.
- Test-runner command configuration beyond the documented Node test runner setup.
- Network, filesystem, or framework-specific attachment behavior.

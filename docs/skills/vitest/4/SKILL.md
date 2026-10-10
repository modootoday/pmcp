---
name: vitest
description: Write and run Vitest 4 test suites with runner-backed module mocking, asynchronous assertions, mock cleanup, fake timers, and bounded execution using the project's test configuration.
metadata:
  target-version: "4.1.11"
---

# Vitest 4 development workflow

This skill targets Vitest 4.1.11. Read the installed Vitest version, scripts,
configuration, and environment before applying examples. Use the versioned
[Vitest 4 documentation](https://v4.vitest.dev/guide/) for this major line; do not
copy Vitest 5-only APIs into a 4.x suite.

## Run real tests

Place test/it callbacks in files discovered by Vitest and execute the project
test script or its local vitest run command. Import expect, test, hooks, and vi
from vitest unless the project intentionally enables globals.

A direct node or bun execution is not a substitute for Vitest's runner and
module transformation. Do not mark imported vi helpers or unexecuted test
callbacks as a passing suite.

```ts
import { expect, test } from "vitest";

test("rejects an unavailable record", async () => {
  const readRecord = async () => {
    throw new Error("unavailable");
  };

  await expect(readRecord()).rejects.toThrow("unavailable");
});
```

Await promise assertions and asynchronous work. A test that finishes before an
assertion runs can report misleading success. Select node, jsdom, happy-dom, or
Browser Mode to match the system under test; changing environments can change
what a passing test proves.

## Preserve the project's execution policy

Use a focused file or name filter while developing. On a constrained machine,
an explicit one-worker, non-parallel-file run can bound resource use:

```sh
vitest run path/to/feature.test.ts --maxWorkers=1 --no-file-parallelism
```

This is an invocation choice, not a reason to overwrite a project's established
pool, browser provider, isolation, coverage, or projects configuration. Vitest 4
removed poolOptions and moved its supported settings to their new locations;
check the [migration guide](https://v4.vitest.dev/guide/migration) when upgrading.
See [fileParallelism](https://v4.vitest.dev/config/fileparallelism) and
[maxWorkers](https://v4.vitest.dev/config/maxworkers) for the CLI options.

## Mock the dependency boundary

vi.mock is hoisted by the runner. Use vi.hoisted for state required by the mock
factory, or keep the factory self-contained. Prefer the import-promise form for
typed module paths. Call the system under test and assert its observable result
as well as the relevant dependency interaction.

```ts
import { expect, test, vi } from "vitest";
import { readUser } from "./service.js";
import { findUser } from "./repository.js";

vi.mock(import("./repository.js"), () => ({
  findUser: vi.fn(async (id: string) => ({ id, name: "Ada" })),
}));

test("reads a user through its repository", async () => {
  await expect(readUser("u1")).resolves.toBe("Ada");
  expect(findUser).toHaveBeenCalledWith("u1");
});
```

Mocking an exported function does not replace calls to that function from inside
the same module. Choose a separable dependency boundary when that matters. ESM
namespace spying also differs in Browser Mode; a Node suite does not establish
that a browser mock works. See the [mocking guide](https://v4.vitest.dev/guide/mocking).

## Keep cleanup intentional

| Operation                     | Intended effect                                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| mockClear / clearAllMocks     | Clear recorded calls while preserving the implementation.                                                                                 |
| mockReset / resetAllMocks     | Clear mock state and reset implementations; vi.fn(initialImplementation) resets to its initial implementation.                            |
| mockRestore / restoreAllMocks | Restore spied-on original methods. In Vitest 4, restoreAllMocks does not clear each spy's recorded history or restore automocked exports. |

Choose clearMocks, mockReset, and restoreMocks for the suite's intended state
model rather than enabling all of them blindly. Restore fake timers and explicit
global/environment stubs even when assertions fail:

```ts
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("resolves after a delay", async () => {
  vi.useFakeTimers();
  const result = new Promise((resolve) => {
    setTimeout(() => resolve("ready"), 100);
  });

  await vi.advanceTimersByTimeAsync(100);
  await expect(result).resolves.toBe("ready");
});
```

Do not combine fake timers and concurrent tests sharing global state. The
[vi API](https://v4.vitest.dev/api/vi) documents reset and restoration behavior.

## Completion evidence

Check the runner exit code and executed test count. Distinguish passing tests,
expected failures, skipped tests, and failures; an empty run or generated report
alone is not proof of success. Report the exact Vitest version, environment, and
targeted command. Coverage and typechecking are separate checks: transformed
TypeScript tests do not prove their types are valid.

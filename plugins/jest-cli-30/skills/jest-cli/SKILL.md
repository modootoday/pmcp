---
name: jest-cli
description: Use jest-cli 30 programmatically and avoid Jest 29 CLI/API shapes.
---

Verified against jest-cli@30.5.1 on 2026-09-08. 2 of 2 examples executed.

# jest-cli 30

## Surface

`jest-cli` exposes exactly three named exports:

```ts
buildArgv(maybeArgv?: string[]): Promise<Config.Argv>
run(maybeArgv?: string[], project?: string): Promise<void>
yargsOptions: {[key: string]: Options}
```

Use the package's documented exports rather than deep imports into Jest internals. Jest 30 bundles internals, so paths such as `jest-runner/build/testWorker` are not stable.

## Parse CLI arguments with `buildArgv`

`buildArgv` asynchronously converts an argument array into Jest's parsed argument object. Pass only the arguments that would follow the `jest` command.

```ts pmcp-example
import assert from 'node:assert/strict';
import {buildArgv} from 'jest-cli';

const argv = await buildArgv(['--runInBand']);
assert.equal(argv.runInBand, true);
```

CLI values take precedence over configuration values when Jest runs. Flags requiring values are validated; for example, `--maxWorkers` and `--selectProjects` must be given values.

## Run Jest programmatically

`run` starts the Jest command-line runner and resolves when the run completes:

```ts
import {run} from 'jest-cli';

await run(['--runInBand'], process.cwd());
```

The runner needs an actual Jest project and test-runner environment. It is not demonstrated as a standalone executable example here because the required examples run with no test files, configuration file, framework globals, filesystem setup, or network access. Ordinary `jest` and `npm test` usage is the supported runner boundary.

Programmatic users of lower-level APIs such as `jest.runCLI` must provide the newly required `globalConfig` in Jest 30. Prefer the documented `jest-cli` exports instead of relying on internals.

## Inspect the option definitions

`yargsOptions` is the exported map of CLI option definitions. The package declaration does not document a complete list of keys or additional behavior.

```ts pmcp-example
import assert from 'node:assert/strict';
import {yargsOptions} from 'jest-cli';

assert.equal(typeof yargsOptions, 'object');
assert.notEqual(yargsOptions, null);
```

## Jest 30 CLI changes

### Rename `--testPathPattern`

Jest 29 code commonly uses:

```sh
jest --testPathPattern="unit/.*"
```

In Jest 30, use the plural option:

```sh
jest --testPathPatterns "unit/.*" "integration/.*"
```

Multiple patterns can be space-separated or supplied repeatedly. `--testPathPattern` was renamed to `--testPathPatterns`.

### `--init` was removed

Do not use:

```sh
jest --init
```

Use the package-manager generators instead:

```sh
npm init jest@latest
yarn create jest
pnpm create jest
```

### Filter result shape

A custom `--filter` implementation must return an object with an array property:

```ts
{filtered: string[]}
```

Returning an array directly is the older shape.

## Common Jest 29-era mistakes

These changes are outside the three `jest-cli` exports but affect projects upgraded to Jest 30:

- Replace `expect(fn).toBeCalled()` with `expect(fn).toHaveBeenCalled()`; matcher aliases were removed.
- Replace `jest.genMockFromModule('fs')` with `jest.createMockFromModule('fs')`; `genMockFromModule` was removed.
- Ensure `jest.mock()` module paths use exact case.
- Custom sequencers receive additional context in Jest 30.

## Runtime requirements

Jest 30 requires Node 18.x or later. Node 14, 16, 19, and 21 are unsupported. The minimum TypeScript version is 5.4. `jest-environment-jsdom` uses JSDOM 26.

## Not covered

This skill does not document the complete `yargsOptions` key set, Jest configuration options, test discovery, custom sequencer APIs, the detailed `globalConfig` shape for lower-level runner APIs, or how to construct a runnable Jest project. Those require behavior or documentation not covered by the supplied research.

---
name: npm-run-path
description: Use npm-run-path ^6.0.0 to construct npm-style PATH values or environment objects for Node child processes.
---

Verified against npm-run-path@6.0.0 on 2026-09-08. 3 of 3 examples executed.

# npm-run-path

`npm-run-path` 6.0.0 is an ESM package requiring Node.js 18 or newer. Import its two named exports:

```ts
import {npmRunPath, npmRunPathEnv} from 'npm-run-path';
```

It supplies PATH data; it is not a runner or CLI. Use the returned environment with Node's `child_process` APIs when launching a local binary outside an npm script.

## API

### `npmRunPath(options?): string`

Returns an augmented PATH string. Its options are:

- `cwd?: string | URL` — defaults to `process.cwd()`.
- `execPath?: string | URL` — defaults to `process.execPath`.
- `addExecPath?: boolean` — defaults to `true`.
- `preferLocal?: boolean` — defaults to `true`.
- `path?: string` — the input PATH value; this option belongs to `npmRunPath()` only.

### `npmRunPathEnv(options?): ProcessEnv`

Returns an augmented environment object based on `process.env`. Its options are:

- `cwd?: string | URL` — defaults to `process.cwd()`.
- `execPath?: string | URL` — defaults to `process.execPath`.
- `addExecPath?: boolean` — defaults to `true`.
- `preferLocal?: boolean` — defaults to `true`.
- `env?: ProcessEnv` — the input environment; this option belongs to `npmRunPathEnv()` only.

`ProcessEnv` is `Record<string, string | undefined>`.

## Examples

### Construct a PATH and an environment

```ts pmcp-example
import assert from 'node:assert/strict';
import {npmRunPath, npmRunPathEnv} from 'npm-run-path';

const path = npmRunPath({
  path: '/usr/bin',
  preferLocal: false,
  addExecPath: false,
});

assert.equal(path, '/usr/bin');

const env = npmRunPathEnv({
  env: {
    PATH: '/usr/bin',
    CUSTOM_VALUE: 'kept',
  },
  preferLocal: false,
  addExecPath: false,
});

assert.equal(env.PATH, '/usr/bin');
assert.equal(env.CUSTOM_VALUE, 'kept');
```

### Pass the generated environment to a child process

The package does not execute commands itself. Pass `npmRunPathEnv()` to a Node child-process API:

```ts pmcp-example
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {npmRunPathEnv} from 'npm-run-path';

const output = childProcess.execFileSync(
  process.execPath,
  ['-e', 'process.stdout.write(process.env.PMCP_VALUE ?? "")'],
  {
    env: npmRunPathEnv({
      env: {
        ...process.env,
        PMCP_VALUE: 'available-to-child',
      },
      preferLocal: false,
      addExecPath: false,
    }),
    encoding: 'utf8',
  },
);

assert.equal(output, 'available-to-child');
```

### Use the options supported by the current type surface

`cwd` and `execPath` accept either strings or URLs. `path` is for `npmRunPath`; `env` is for `npmRunPathEnv`. Do not interchange those option names.

```ts pmcp-example
import assert from 'node:assert/strict';
import {npmRunPath, npmRunPathEnv} from 'npm-run-path';

const path = npmRunPath({
  cwd: new URL('.', import.meta.url),
  execPath: process.execPath,
  path: '/custom/path',
  preferLocal: false,
  addExecPath: false,
});
assert.equal(path, '/custom/path');

const environment = npmRunPathEnv({
  cwd: new URL('.', import.meta.url),
  execPath: process.execPath,
  env: {PATH: '/custom/path'},
  preferLocal: false,
  addExecPath: false,
});
assert.equal(environment.PATH, '/custom/path');
```

## Common mistakes

- **Using CommonJS imports:** v6 is ESM (`"type": "module"`). Use named ESM imports from `npm-run-path`.
- **Expecting the package to run a command:** it only computes PATH data. Launch the command with Node's `child_process` APIs and provide `env: npmRunPathEnv()`.
- **Using the wrong input option:** `path` is accepted by `npmRunPath()`, while `env` is accepted by `npmRunPathEnv()`.
- **Assuming the older major has a different API:** the v5.3.0 examples use effectively the same two-function shape and option names. Code copied from that older documentation is still representative, but v6 requires Node.js 18 or newer.
- **Forgetting the defaults:** local npm binaries are preferred by default, the executable path is added by default, and the current working directory and `process.execPath` are used by default.
- **Re-augmenting a PATH without considering v6 behavior:** v6 makes the operation idempotent and handles an empty PATH better.

## Not covered

This skill does not cover the internal directory-search algorithm, the exact ordering of every generated PATH segment, platform-specific PATH details, or the separate `npm-run-path-cli` package. It also does not cover runner-injected globals such as `describe`, `it`, or `expect`; examples here are standalone Bun scripts.

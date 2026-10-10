---
name: yeoman-environment
description: Use yeoman-environment's ESM environment API when working against the v7.0.0 source shape. Note that ^7.0.0 is not a published version according to the researched npm metadata; verify the installed version before relying on this skill.
---

Verified against yeoman-environment@7.0.0 on 2026-09-08. 3 of 3 examples executed.

# yeoman-environment

## Version reality

The requested range is `^7.0.0`, but the researched npm versions list `6.3.0` as the current published version. No v7 release or v7 changelog was found. Do not assume that `^7.0.0` can be installed from npm, and do not describe this as a verified published v7 API. The API notes below follow the v7.0.0 source snapshot supplied for this task.

The source snapshot is an ESM package. Use named imports or the default `Environment` export; do not copy the older CommonJS examples blindly.

## Core environment

Create an environment with `createEnv(options?)`:

```ts pmcp-example
import assert from 'node:assert/strict';
import { createEnv } from 'yeoman-environment';

const env = createEnv({ skipInstall: true });

assert.equal(typeof env.lookup, 'function');
assert.equal(typeof env.create, 'function');
assert.equal(typeof env.run, 'function');
assert.equal(typeof env.runGenerator, 'function');
assert.equal(typeof env.register, 'function');
assert.equal(typeof env.registerStub, 'function');
```

`Environment.run(arguments?, options?)` accepts either a command string or an argument array. The documented workflow first awaits `env.lookup()` to search the current working directory for installed generators, then awaits `env.run(...)`.

```ts pmcp-example
import assert from 'node:assert/strict';
import { createEnv } from 'yeoman-environment';

const env = createEnv({ skipInstall: true });
const result = await env.lookup();

// Lookup completes without requiring a generator to be selected.
assert.ok(result === undefined || typeof result === 'object');
```

The environment also exposes `create`, `runGenerator`, `register`, and `registerStub` for programmatic generator lifecycle work. The supplied research identifies these methods but does not specify their complete argument and return-value contracts, so do not invent those contracts from older documentation.

## Generator lookup

`lookupGenerator(namespace, options?)` is a named export. By default it returns one string; with `{singleResult: false}` it returns an array of strings. With `{packagePath: true}`, the lookup can return the generator package path rather than a generator namespace match.

Lookup depends on installed generators and the process environment, so a deterministic standalone assertion should only check the documented result shape for a lookup that actually resolves in the target installation:

```ts pmcp-example
import assert from 'node:assert/strict';
import { lookupGenerator } from 'yeoman-environment';

const matches = lookupGenerator('yeoman-environment', { singleResult: false });
assert.ok(Array.isArray(matches));
for (const match of matches) assert.equal(typeof match, 'string');
```

Do not confuse `lookupGenerator` with `env.lookup()`: the former is the exported generator-resolution helper, while the latter performs environment lookup before a run.

## Registering and running

The current README shape uses ESM and async calls:

```ts
import { createEnv } from 'yeoman-environment';

const env = createEnv({ skipInstall: true });
await env.lookup();
await env.run('angular', { skipInstall: true });
```

An environment can register a generator with a namespace and resolved location, then run an argument array:

```ts
import { createEnv } from 'yeoman-environment';

const env = createEnv({ skipInstall: true });
env.register(generator, { namespace: 'example:app', resolved });
await env.run(['example:app', 'arg'], { help: true });
```

The names `generator` and `resolved` above must be supplied by the caller. The research does not define a standalone generator implementation or a complete stub-generator contract, so do not turn this snippet into a supposedly runnable generator test without consulting the installed package's types/source.

## Command preparation

`prepareCommand(options)` prepares a Commander command. `prepareGeneratorCommand(options)` registers a generator and runs it through the environment. The documented preparation shape includes `resolved` and `namespace`:

```ts
import { prepareCommand } from 'yeoman-environment';

const command = await prepareCommand({
  resolved: '/path/to/generator',
  namespace: 'example:app',
});
await command.parseAsync(process.argv);
```

These functions are command/CLI integration APIs. They are not appropriate for a direct `bun example.ts` example unless the caller supplies a real generator path and command-line setup.

## Package-manager installation task

`packageManagerInstallTask(options)` returns `Promise<boolean>`. Its options include `memFs`, `packageJsonLocation`, `adapter`, and `skipInstall`; supported package managers are npm, Yarn, pnpm, and Bun.

```ts
import { packageManagerInstallTask } from 'yeoman-environment';

const installed = await packageManagerInstallTask({
  memFs,
  packageJsonLocation: process.cwd(),
  adapter,
  skipInstall: false,
});
```

This task requires caller-provided `memFs` and adapter objects and can invoke a package manager. It is therefore not a valid isolated example under the execution constraints for this skill; use it from the Yeoman environment that supplies those dependencies.

## Common mistakes

- Do not use `require('yeoman-environment')` for the researched source shape; it is ESM.
- Do not assume `^7.0.0` is installable: the researched npm metadata reports `6.3.0` as the latest published version.
- Do not copy the older v2-style `const yeoman = require(...)` example as the current API.
- Do not call `describe`, `it`, or `expect` in a direct script. Yeoman environment is not a test runner.
- Do not expect `TerminalAdapter` or `EnvironmentCommand.execute()` to be standalone helpers. They provide CLI interaction and Commander-based command execution.
- Do not claim that a successful `env.lookup()` means a generator was run; lookup and run are separate operations.
- Pass `skipInstall: true` when demonstrating lifecycle behavior that should not install dependencies.
- Await `lookup`, `run`, command parsing, and package-manager tasks.

## Not covered

This skill does not establish a published v7 release, a v7 migration path, complete generator or stub-generator argument contracts, the exact return values of all `Environment` methods, a standalone `TerminalAdapter` setup, or a runnable package-manager installation example. It also does not cover generator implementation APIs, filesystem/mem-fs construction, Commander configuration beyond the preparation surface described above, or behavior that requires a real installed generator or Yeoman CLI environment.

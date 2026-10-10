---
name: release-it
description: Practical guidance for release-it ^21.0.0, including its ESM programmatic API, Config and Plugin classes, CLI-oriented workflow, v21 changes, and standalone examples.
---

Verified against release-it@21.0.2 on 2026-09-08. 3 of 3 examples executed.

# release-it ^21

## Runtime and module format

- The observed package version is `21.0.1`.
- It is an ES module package. Use `import`, not CommonJS `require()`.
- The supported Node engine is `^22.21.0 || >=24.0.0`; Node 20 is no longer supported.
- The public package exports are the default runner, `Config`, and `Plugin`:

```js
import releaseIt, { Config, Plugin } from 'release-it';
```

Older examples using CommonJS or older programmatic/plugin shapes are not appropriate for v21. Programmatic usage and plugins use ES module syntax.

## Normal usage is CLI-first

release-it is mostly used as a CLI tool. The usual setup is a package script:

```json
{
  "scripts": {
    "release": "release-it"
  },
  "devDependencies": {
    "release-it": "^21.0.0"
  }
}
```

Configuration is normally read from `.release-it.json` or the `release-it` property in `package.json`.

Interactive prompts are the default. Use `--ci` for non-interactive execution; CI environments automatically enable non-interactive mode. Release operations involving GitHub or GitLab need the relevant environment tokens, and pushing Git tags requires authenticated Git access.

## Programmatic runner

The default export is an async function:

```js
const result = await releaseIt(opts, di);
```

The documented result has this shape:

```js
{
  name,
  changelog,
  latestVersion,
  version
}
```

It accepts CLI-equivalent options including `ci`, `only-version`, `release-version`, `changelog`, `dry-run`, and `verbose`. A direct call still represents a release flow: it is not merely a version-formatting helper. Keep it isolated from publishing, tag pushing, and other side effects with `dry-run` while developing integrations.

```ts pmcp-example
import assert from 'node:assert/strict';
import releaseIt from 'release-it';

const result = await releaseIt({
  config: false,
  ci: true,
  'dry-run': true,
  increment: 'patch'
});

for (const key of ['name', 'changelog', 'latestVersion', 'version']) {
  assert.ok(Object.hasOwn(result, key), `missing result key: ${key}`);
}
```

The runner and its release plugins are designed around a project/repository and the tool's own execution flow. Do not assume that `dry-run` turns the package into a pure function or makes network credentials unnecessary for every enabled plugin.

## `Config`

`Config` is the programmatic configuration/context object. Construct it with an options object, call `init()` before relying on initialized configuration, and use `setContext()`/`getContext()` for release context.

Useful members include:

- `init()`
- `getContext(path)` and `setContext(options)`
- `setCI(value = true)`
- `options` and `localConfig`
- `defaultConfig`
- `isDryRun`, `isIncrement`, `isVerbose`, `verbosityLevel`, `isDebug`, `isQuiet`, `isCI`
- `isPromptOnlyVersion`, `isReleaseVersion`, and `isChangelog`

Set `config: false` when constructing an isolated configuration object and do not want local configuration files involved.

```ts pmcp-example
import assert from 'node:assert/strict';
import { Config } from 'release-it';

const config = new Config({
  config: false,
  increment: 'patch',
  ci: true
});

await config.init();
config.setContext({ version: '1.2.3' });

assert.equal(config.getContext('version'), '1.2.3');
assert.equal(config.isCI, true);
assert.equal(config.options.increment, 'patch');
```

## `Plugin`

`Plugin` is the base class for release-it's plugin architecture. A plugin can provide a static `isEnabled(options)` method and asynchronous lifecycle methods such as `getName()`.

```ts pmcp-example
import assert from 'node:assert/strict';
import { Plugin } from 'release-it';

class ExamplePlugin extends Plugin {
  static isEnabled() {
    return true;
  }

  async getName() {
    return 'example';
  }
}

assert.equal(ExamplePlugin.isEnabled({}), true);
const plugin = new ExamplePlugin({}, {});
assert.equal(await plugin.getName(), 'example');
```

The built-in plugin areas include Git, GitHub, GitLab, and npm. A custom plugin participates in release-it's lifecycle; defining `getName()` alone does not perform a release.

## Configuration shape

The declarations expose these configuration areas:

```ts
interface Config {
  hooks?: Hooks;
  plugins?: Record<string, Record<string, any>>;
  git?: {
    commit?: boolean;
    tag?: boolean;
    push?: boolean;
    commitMessage?: string;
  };
  npm?: {
    publish?: boolean;
    publishPath?: string;
    publishPackageManager?: 'npm' | 'pnpm' | 'bun';
  } | false;
  github?: {
    release?: boolean;
    releaseName?: string;
    releaseNotes?: string | null;
  };
}
```

## Hooks are shell commands

Hooks are command strings or arrays of command strings, not JavaScript callback functions:

```json
{
  "hooks": {
    "before:init": ["npm run lint", "npm test"],
    "after:bump": "npm run build",
    "after:release": "echo Successfully released ${name} v${version}"
  }
}
```

Hook commands can use release-it template variables. The `init` hook does not yet have the additional variables listed in the documentation.

## v21 CLI changes

CLI parsing is strict in v21:

- Unknown options are rejected.
- Invalid boolean values are rejected.
- Extra positional arguments are rejected.

Do not pass arbitrary flags or rely on permissive parsing from an older major version.

GitLab server certificates are verified by default. For a private certificate authority, configure the private CA; alternatively, `gitlab.secure` can be set to `false` when that is intentionally required.

## What this skill does not cover

- The complete release-it CLI option reference.
- The complete plugin lifecycle or every plugin hook.
- GitHub/GitLab token setup, private CA configuration, or authenticated Git setup.
- The exact generated changelog, version-selection rules, or repository state transitions.
- A full `.release-it.json` or `package.json` project configuration.
- Network-backed publishing, Git operations, or CI-provider-specific setup.

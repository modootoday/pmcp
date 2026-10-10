---
name: eslint-plugin-testing-library
description: Practical guidance for eslint-plugin-testing-library ^7.0.0, including v7 compatibility requirements, legacy and flat ESLint configuration, available rules, customization settings, and common migration mistakes.
---

Verified against eslint-plugin-testing-library@7.16.2 on 2026-09-08. 3 of 3 examples executed.

# eslint-plugin-testing-library ^7.0.0

## What this package is

`eslint-plugin-testing-library` is an ESLint plugin, not a test runner and not a standalone executable. Install and use it with ESLint. Its published entry point exposes one plugin object containing `rules` and `configs`.

v7 supports:

- Node `^18.18.0`, `^20.9.0`, or `>=21.1.0`
- ESLint `^8.57.0` or `^9.0.0`
- `typescript-eslint` v8
- npm `>=9.8.1`

The plugin's peer dependency is ESLint `^8.57.0 || ^9.0.0`.

## Configuration shapes

### Flat config

v7 provides flat-config entries whose names start with `flat/`. Apply one to the files that contain tests:

```js
const testingLibrary = require('eslint-plugin-testing-library');

module.exports = [
  {
    files: ['**/*.test.{js,jsx,ts,tsx}'],
    ...testingLibrary.configs['flat/react'],
  },
];
```

Documented flat names are:

- `flat/dom`
- `flat/angular`
- `flat/react`
- `flat/vue`
- `flat/marko`

Do not use the legacy `plugin:testing-library/react` string inside a flat config. Spread the corresponding `configs['flat/...']` object instead.

### Legacy `.eslintrc` config

The older configuration form remains documented and commonly appears in existing code:

```js
module.exports = {
  overrides: [
    {
      files: ['**/__tests__/**/*.[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)'],
      extends: ['plugin:testing-library/react'],
    },
  ],
};
```

A direct legacy rule configuration looks like this:

```js
module.exports = {
  plugins: ['testing-library'],
  rules: {
    'testing-library/await-async-queries': 'error',
    'testing-library/no-await-sync-queries': 'error',
    'testing-library/no-debugging-utils': 'warn',
    'testing-library/no-dom-import': 'off',
  },
};
```

The legacy preset names documented by the package are `dom`, `angular`, `react`, `vue`, `svelte`, and `marko`. The flat names are prefixed with `flat/`; do not assume every legacy preset has an identically named flat entry (the documented flat list does not include `flat/svelte`).

## Rules

The documented rules include:

- `await-async-events`
- `await-async-queries`
- `await-async-utils`
- `consistent-data-testid`
- `no-await-sync-events`
- `no-await-sync-queries`
- `no-container`
- `no-debugging-utils`
- `no-dom-import`
- `no-global-regexp-flag-in-query`
- `no-manual-cleanup`
- `no-node-access`
- `no-promise-in-fire-event`
- `no-render-in-lifecycle`
- `no-unnecessary-act`
- `no-wait-for-multiple-assertions`
- `no-wait-for-side-effects`
- `no-wait-for-snapshot`
- `prefer-explicit-assert`
- `prefer-find-by`
- `prefer-implicit-assert`
- `prefer-presence-queries`
- `prefer-query-by-disappearance`
- `prefer-query-matchers`
- `prefer-screen-queries`
- `prefer-user-event`
- `render-result-naming-convention`

Rules are consumed by ESLint configuration. This package does not provide a command that runs a test file directly. Fixes are requested through ESLint, for example with the ESLint CLI's `--fix` option.

## Custom utilities and queries

Add project-specific Testing Library APIs through the `settings` key in ESLint configuration:

```js
module.exports = {
  settings: {
    'testing-library/utils-module': 'my-custom-test-utility-file',
    'testing-library/custom-renders': ['display', 'renderWithProviders'],
    'testing-library/custom-queries': ['ByIcon', 'getByComplexText'],
  },
};
```

These settings belong in the ESLint configuration used for the relevant files; they are not arguments to the plugin import.

## Migration traps

### Do not copy removed v6-era rule names

If code is migrating from an older major, v6 had already removed or renamed these names:

- `prefer-wait-for`
- `no-wait-for-empty-callback`
- `await-fire-event`
- `await-async-query` (singular)
- `no-await-sync-query` (singular)
- `no-render-in-setup`

Use the v7 documented names such as `await-async-queries` and `no-await-sync-queries` where appropriate. The singular forms are a common stale-configuration mistake.

### Do not treat v7 as a runner

A direct `bun example.ts` file cannot exercise ESLint rules by using `describe`, `it`, or `expect`; those are not supplied by this package. Use the programmatic package surface only for inspecting the plugin object, and exercise linting through ESLint itself.

## Standalone package-surface checks

These examples only inspect the published plugin object. They do not run ESLint, and therefore need no runner globals, configuration file, test framework, network, or filesystem.

```ts pmcp-example
import assert from 'node:assert/strict';

const testingLibrary = require('eslint-plugin-testing-library');

assert.equal(typeof testingLibrary, 'object');
assert.equal(typeof testingLibrary.rules, 'object');
assert.equal(typeof testingLibrary.configs, 'object');
assert.equal(typeof testingLibrary.rules['await-async-queries'], 'object');
assert.equal(typeof testingLibrary.rules['no-debugging-utils'], 'object');
```

```ts pmcp-example
import assert from 'node:assert/strict';

const testingLibrary = require('eslint-plugin-testing-library');

for (const name of ['dom', 'angular', 'react', 'vue', 'svelte', 'marko']) {
  assert.equal(typeof testingLibrary.configs[name], 'object');
}

for (const name of ['flat/dom', 'flat/angular', 'flat/react', 'flat/vue', 'flat/marko']) {
  assert.equal(typeof testingLibrary.configs[name], 'object');
}
```

```ts pmcp-example
import assert from 'node:assert/strict';

const testingLibrary = require('eslint-plugin-testing-library');
const reactFlat = testingLibrary.configs['flat/react'];

assert.equal(typeof reactFlat, 'object');
assert.ok(reactFlat !== null);
assert.ok(Object.prototype.hasOwnProperty.call(reactFlat, 'plugins'));
```

## Does not cover

This skill does not cover individual rule semantics, rule options, exact diagnostics, ESLint API invocation, parser configuration, framework setup, or the full migration history before v6. Those require information not present in the supplied research. The examples also do not perform linting because this package's documented surface is consumed by ESLint rather than by a standalone runner.

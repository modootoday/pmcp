---
name: eslint-plugin-react-hooks
description: Use eslint-plugin-react-hooks ^7.0.0 correctly, including its flat and legacy presets, rule names, custom-hook dependency configuration, and the preset-shape changes from older releases.
---

Verified against eslint-plugin-react-hooks@7.1.1 on 2026-09-08. 2 of 2 examples executed.

# eslint-plugin-react-hooks ^7.0.0

`eslint-plugin-react-hooks` is an ESLint plugin, not a standalone hooks runtime. Its package entry point is `./index.js`, its TypeScript declarations are `./index.d.ts`, and it requires Node `>=18`.

Import the plugin object by package name:

```ts
import reactHooks from 'eslint-plugin-react-hooks';
```

## Presets

Version 7 has two preset families:

- `recommended`: the recommended rules, including the compiler rules enabled by default in this release.
- `recommended-latest`: the recommended rules plus bleeding-edge experimental compiler rules.

For ESLint flat config, use the `flat` presets:

```ts
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  reactHooks.configs.flat.recommended,
  // Or:
  // reactHooks.configs.flat['recommended-latest'],
]);
```

For ESLint versions using legacy configuration, the documented form is:

```json
{
  "extends": ["plugin:react-hooks/recommended"]
}
```

Do not use the older `flat/recommended` preset name. In 7.0.0, `flat/recommended` and `recommended-latest-legacy` were removed. The current flat form is `reactHooks.configs.flat.recommended`.

## Explicit rule configuration

When configuring rules yourself, register the plugin under the `react-hooks` key:

```js
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    files: ['**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/config': 'error',
      'react-hooks/error-boundaries': 'error',
      'react-hooks/gating': 'error',
      'react-hooks/globals': 'error',
      'react-hooks/immutability': 'error',
      'react-hooks/preserve-manual-memoization': 'error',
    },
  },
];
```

The documented recommended rule names are:

- `exhaustive-deps`
- `rules-of-hooks`
- `component-hook-factories`
- `config`
- `error-boundaries`
- `gating`
- `globals`
- `immutability`
- `incompatible-library`
- `preserve-manual-memoization`
- `purity`
- `refs`
- `set-state-in-effect`
- `set-state-in-render`
- `static-components`
- `unsupported-syntax`
- `use-memo`

Compiler diagnostics are exposed through these ESLint rules and can be used even when the application has not adopted the compiler.

## `exhaustive-deps` and custom hooks

`exhaustive-deps` accepts an `additionalHooks` option containing a regular expression for custom hooks whose dependency arrays should also be checked:

```json
{
  "rules": {
    "react-hooks/exhaustive-deps": [
      "warn",
      {
        "additionalHooks": "(useMyCustomHook|useMyOtherCustomHook)"
      }
    ]
  }
}
```

Treat `additionalHooks` as an ESLint rule option; it is not a separate plugin API.

## Runnable package-surface checks

These examples only inspect the package because the plugin itself is consumed by ESLint. They do not attempt to invoke `describe`, `it`, `expect`, or an ESLint runner.

### Plugin rules and exports

```ts pmcp-example
import assert from 'node:assert/strict';
import reactHooks from 'eslint-plugin-react-hooks';

assert.equal(typeof reactHooks, 'object');
assert.equal(typeof reactHooks.rules, 'object');
assert.equal(typeof reactHooks.configs, 'object');

for (const name of [
  'exhaustive-deps',
  'rules-of-hooks',
  'component-hook-factories',
  'config',
  'error-boundaries',
  'gating',
  'globals',
  'immutability',
  'incompatible-library',
  'preserve-manual-memoization',
  'purity',
  'refs',
  'set-state-in-effect',
  'set-state-in-render',
  'static-components',
  'unsupported-syntax',
  'use-memo',
]) {
  assert.equal(typeof reactHooks.rules[name], 'object', `missing rule: ${name}`);
}
```

### Flat and legacy preset shapes

```ts pmcp-example
import assert from 'node:assert/strict';
import reactHooks from 'eslint-plugin-react-hooks';

assert.equal(typeof reactHooks.configs.flat, 'object');
assert.equal(typeof reactHooks.configs.flat.recommended, 'object');
assert.equal(typeof reactHooks.configs.flat['recommended-latest'], 'object');

assert.ok('recommended' in reactHooks.configs);
assert.ok('recommended-latest' in reactHooks.configs);
assert.equal('recommended-latest-legacy' in reactHooks.configs, false);
assert.equal('flat/recommended' in reactHooks.configs, false);
```

## What this skill does not cover

- Running ESLint or integrating the plugin into a particular ESLint project.
- The diagnostics or autofix behavior of individual rules.
- The exact compiler rules included in each preset beyond the documented preset distinction.
- ESLint configuration-file discovery, ignores, parser setup, or framework integration.
- Repository development and test tooling such as building the compiler before running the package's own tests.

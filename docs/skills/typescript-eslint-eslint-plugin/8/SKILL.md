---
name: typescript-eslint-eslint-plugin
description: Use @typescript-eslint/eslint-plugin v8 exports, legacy preset names, rule definitions, typed-linting requirements, and v8 migration constraints.
---

Verified against @typescript-eslint/eslint-plugin@8.70.0 on 2026-09-08. 3 of 3 examples executed.

# @typescript-eslint/eslint-plugin

## What this package provides

`@typescript-eslint/eslint-plugin` v8 is an ESLint plugin used to load typescript-eslint rules and configuration lists. Its documented exports are:

- `configs`: named ESLint configuration settings.
- `rules`: rule objects.

The rules rely on `@typescript-eslint/parser` for TypeScript ASTs and, for type-aware rules, TypeScript programs.

```ts pmcp-example
import * as plugin from '@typescript-eslint/eslint-plugin';
import assert from 'node:assert/strict';

assert.equal(typeof plugin.configs, 'object');
assert.equal(typeof plugin.rules, 'object');
assert.equal(typeof plugin.configs.recommended, 'object');
assert.equal(typeof plugin.rules['no-unused-vars'], 'object');
```

## Configuration names: do not mix package shapes

The plugin's legacy configuration names are exposed through `plugin.configs` and are used by `.eslintrc.*` through `plugin:@typescript-eslint/...` strings. Documented legacy preset strings include:

- `plugin:@typescript-eslint/recommended`
- `plugin:@typescript-eslint/recommended-type-checked`
- `plugin:@typescript-eslint/strict`
- `plugin:@typescript-eslint/stylistic`
- `plugin:@typescript-eslint/eslint-recommended`

The direct property names for this plugin's legacy presets are not the camel-cased names from the `typescript-eslint` meta-package's flat-config API. In particular, do not assume that `plugin.configs.recommendedTypeChecked` exists: importing this package directly with v8 can leave that property undefined.

```ts pmcp-example
import * as plugin from '@typescript-eslint/eslint-plugin';
import assert from 'node:assert/strict';

const legacyNames = [
  'recommended',
  'recommended-type-checked',
  'strict',
  'stylistic',
  'all',
  'base',
  'disable-type-checked',
  'eslint-recommended',
];

for (const name of legacyNames) {
  assert.equal(typeof plugin.configs[name], 'object', `missing config: ${name}`);
}

assert.equal(plugin.configs.recommendedTypeChecked, undefined);
```

This distinction is a common v8 mistake. Names such as `recommendedTypeChecked`, `strictTypeChecked`, `stylisticTypeChecked`, and the `...Only` variants are documented configuration names for the newer `typescript-eslint` configuration surface, not names to blindly substitute for properties on this plugin export.

## Rules

Rule definitions are available by rule name in `rules`. For example, `no-unused-vars` is exposed as a rule object:

```ts pmcp-example
import * as plugin from '@typescript-eslint/eslint-plugin';
import assert from 'node:assert/strict';

const rule = plugin.rules['no-unused-vars'];
assert.equal(typeof rule, 'object');
assert.ok(rule !== null);
```

A plain script can inspect these definitions, but this package does not itself run ESLint rules. Rule execution is performed by ESLint with the plugin and parser configured.

## Legacy `.eslintrc.*` setup

The older configuration shape remains supported in v8 and is still common. Legacy setup requires both the parser and plugin registration for TypeScript files:

```js
module.exports = {
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/stylistic',
  ],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  root: true,
};
```

Type-aware legacy presets can be selected with their hyphenated names:

```js
module.exports = {
  extends: [
    'plugin:@typescript-eslint/recommended-type-checked',
    'plugin:@typescript-eslint/strict',
    'plugin:@typescript-eslint/stylistic',
    'plugin:@typescript-eslint/eslint-recommended',
  ],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
};
```

Do not use a legacy `extends` string as though it were a camel-cased property on `plugin.configs`, and do not omit the parser when linting TypeScript syntax.

## Flat config and v8

v8 has full ESLint v9 support while retaining legacy configuration support. The newer flat-config shape uses the `typescript-eslint` meta-package and object configs:

```js
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig({
  files: ['**/*.{js,ts}'],
  extends: [js.configs.recommended, tseslint.configs.recommended],
});
```

For flat config, the documentation says that `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser` do not need to be installed explicitly. Do not mechanically copy the legacy `plugins: ['@typescript-eslint']` setup into this flat-config example.

## Typed linting

Type-aware presets require typed-linting parser options. In v8, `projectService` is the stabilized option replacing experimental `EXPERIMENTAL_useProjectService`:

```js
languageOptions: {
  parserOptions: {
    projectService: true,
  },
},
```

The `recommended-type-checked` and `strict-type-checked` presets require this setup. `disable-type-checked` is provided for files such as JavaScript overrides.

Importing a rule or config in a standalone script does not provide typed linting. The parser and TypeScript program are supplied by the ESLint configuration and tool execution.

## v8 rule and configuration changes

Do not copy older rule lists into v8 unchanged:

- `ban-types` was replaced by `no-restricted-types`, `no-unsafe-function-type`, and `no-wrapper-object-types`.
- `no-empty-object-type` was split from `ban-types` / `no-empty-interfaces`.
- `no-unnecessary-type-parameters` moved to `strict`.
- `no-throw-literal`, `no-useless-template-literals`, and the `no-loss-of-precision` extension rule were removed or deprecated.

## Does not cover

This skill does not cover ESLint's complete CLI or API, the complete contents or options of individual rules and presets, TypeScript project configuration, parser installation details beyond the documented setup, or running linting in a framework or repository. Rule execution and typed linting are exercised by ESLint itself rather than by this package's standalone exports.

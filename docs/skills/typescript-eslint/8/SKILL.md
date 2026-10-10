---
name: typescript-eslint
description: Use typescript-eslint v8's unified flat-config package, extension lists, presets, and typed-linting configuration. Avoid carrying forward the split-package or legacy ESLint configuration shape unless the project explicitly uses legacy config.
---

Verified against typescript-eslint@8.70.0 on 2026-09-08. 3 of 3 examples executed.

Those historical examples inspect exports and configuration composition only.
The separate ESLint 9/10 fixtures exercise actual typed linting and project
service behavior; their execution evidence is tracked separately.

# typescript-eslint v8

## Use the unified package first

For v8, install the unified package:

```sh
npm i -D typescript-eslint@8
```

The main package exports `config`, `configs`, `extensions`, `globs`, `parser`, `plugin`, and `FlatConfig`. Its `parser` and `plugin` exports provide the TypeScript parser and ESLint plugin surfaces.

The preferred v8 setup is ESLint flat config. The recommended and stylistic presets already configure the TypeScript parser and plugin, so do not manually register them when using those presets.

```js
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig({
  files: ["**/*.{js,ts}"],
  extends: [js.configs.recommended, tseslint.configs.recommended],
});
```

`tseslint.config(...)` accepts any number of ESLint configuration objects, but it is deprecated. Prefer ESLint core's `defineConfig(...)` for new flat configurations.

## File extensions and globs

Use the exported extension lists instead of duplicating them:

- `extensions.ts`: `['mts', 'ts', 'cts', 'tsx']`
- `extensions.js`: `['mjs', 'js', 'cjs', 'jsx']`
- `extensions.jsts`: both sets; do not rely on the order of this combined list

```ts pmcp-example
import assert from "node:assert/strict";
import tseslint from "typescript-eslint";

assert.deepEqual(tseslint.extensions.ts, ["mts", "ts", "cts", "tsx"]);
assert.deepEqual(tseslint.extensions.js, ["mjs", "js", "cjs", "jsx"]);
assert.deepEqual(
  [...tseslint.extensions.jsts].sort(),
  ["mjs", "js", "cjs", "jsx", "mts", "ts", "cts", "tsx"].sort(),
);

const customGlob = `src/**/*.{${tseslint.extensions.ts.join(",")}}`;
assert.equal(customGlob, "src/**/*.{mts,ts,cts,tsx}");
```

## Main package exports

A plain script can inspect and compose the main package exports without running ESLint:

```ts pmcp-example
import assert from "node:assert/strict";
import tseslint from "typescript-eslint";

assert.equal(typeof tseslint.config, "function");
assert.equal(typeof tseslint.parser, "object");
assert.equal(typeof tseslint.plugin, "object");
assert.equal(typeof tseslint.configs.recommended, "object");
assert.ok(tseslint.extensions.ts.includes("ts"));
assert.ok(tseslint.extensions.js.includes("js"));
```

Do not assume that the parser export has a `parse` method. The package exposes the parser object, but that particular method is not part of the verified standalone surface.

The `config` helper is still available for compatibility, but new configuration should use ESLint's `defineConfig`. When using `config`, pass ESLint configuration objects rather than legacy string-based `extends` entries.

```ts pmcp-example
import assert from "node:assert/strict";
import tseslint from "typescript-eslint";

const result = tseslint.config({
  files: ["**/*.ts"],
  extends: [tseslint.configs.recommended],
  rules: {
    "@typescript-eslint/array-type": "error",
  },
});

assert.ok(Array.isArray(result));
assert.ok(result.length > 0);
```

## Typed linting

Type-aware rules need TypeScript project/type information. They are not enabled merely by selecting a TypeScript parser. In flat config, use parser options with `projectService: true`:

```js
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig({
  files: ["src/**/*.ts"],
  extends: [tseslint.configs.recommendedTypeChecked],
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
});
```

The type-checked preset names in v8 are `recommendedTypeChecked` and `stylisticTypeChecked`. The hyphenated names `recommended-type-checked` and `stylistic-type-checked` are the legacy names commonly shown in older configuration examples.

`projectService` uses TypeScript's editor-style service and generally replaces manually specifying `project` paths or creating a separate `tsconfig.eslint.json`. It is parser configuration consumed by ESLint; it is not a standalone typed-linting switch for an arbitrary script.

## Parser utilities

The research describes parser utilities such as `createProgram(configFile, projectDirectory?)` and `withoutProjectParserOptions(options)`. However, the verified `typescript-eslint` v8 standalone package export does not expose the tested utility methods through `tseslint.parser`; do not write code that assumes `tseslint.parser.createProgram` or `tseslint.parser.withoutProjectParserOptions` exists.

These APIs are therefore not demonstrated here. Parser configuration and typed project services are primarily consumed while ESLint runs the configuration.

## Legacy configuration warning

Older projects may still use the split packages and `.eslintrc` shape:

```js
module.exports = {
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  root: true,
};
```

That setup requires separately installed `@typescript-eslint/parser` and `@typescript-eslint/eslint-plugin` and is run through ESLint. Do not translate it mechanically into v8 flat config: use the unified `typescript-eslint` package and its exported presets instead. v8 supports ESLint v9 and flat config; v7 was the first version with flat-config support.

## Execute typed linting

Version 8.70.0's peer range supports ESLint 8.57+, 9 and 10, and TypeScript
`>=4.8.4 <6.1`. Earlier 8.x patches can have different supported ranges. Check the
installed parser/plugin versions instead of installing a second incompatible
copy as a workaround.

Run the project's installed ESLint CLI on a real file inside its tsconfig.
projectService uses the editor-style project boundary; files outside it need
a separate untyped scope or a deliberately narrow default-project allowance.
Keep allowDefaultProject bounded rather than matching all source files.

```sh
eslint src/example.ts --max-warnings=0
eslint --print-config src/example.ts
```

Verify a type-aware rule with a source case that actually needs type information,
such as an unhandled promise. Check both the intended failing case and a valid
handled case. Parsing or importing the rule preset alone is not a typed-lint
verification. Keep compiler diagnostics under the project's own typecheck.

## What this skill does not cover

- The detailed contents of every preset or every rule.
- Creating a real TypeScript `Program` from a filesystem project.
- The standalone `@typescript-eslint/project-service` API, including `createProjectService`, its settings, and lifecycle.
- The separate `@typescript-eslint/utils` package and its exported AST, scope, and utility APIs.
- Parser utility methods not verified on the unified package's standalone parser export.
- Legacy ESLint configuration migration details beyond the v8 versus older configuration shapes described above.

## Sources

- [Unified package](https://typescript-eslint.io/packages/typescript-eslint/)
- [Typed linting and project service](https://typescript-eslint.io/getting-started/typed-linting/)
- [Troubleshooting typed linting](https://typescript-eslint.io/troubleshooting/typed-linting/)
- [ESLint flat configuration](https://eslint.org/docs/latest/use/configure/configuration-files)

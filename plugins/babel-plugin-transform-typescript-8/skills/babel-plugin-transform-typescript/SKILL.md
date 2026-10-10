---
name: babel-plugin-transform-typescript
description: Use @babel/plugin-transform-typescript 8.0.0 with Babel 8 to strip and transform TypeScript syntax.
---

Verified against @babel/plugin-transform-typescript@8.0.1 on 2026-09-08. 4 of 4 examples executed.

# @babel/plugin-transform-typescript

## Scope

The resolved version is `8.0.0`. The package is ESM and has one default runtime export: the Babel plugin. It has no named runtime exports. The only documented subpath is `@babel/plugin-transform-typescript/package.json`.

Use it with Babel 8's `@babel/core`; the plugin itself is not a runner. A compatible Babel core is required—do not mix Babel 7 and Babel 8 major versions. The plugin transforms TypeScript syntax but does not type-check input.

```ts pmcp-example
import assert from "node:assert/strict";
import { transformSync } from "@babel/core";
import transformTypeScript from "@babel/plugin-transform-typescript";

const result = transformSync("const value: number = 0;", {
  plugins: [transformTypeScript],
});

assert.ok(result?.code);
assert.match(result.code, /const value = 0/);
assert.doesNotMatch(result.code, /: number/);
```

## Basic transformation

The plugin removes TypeScript-only annotations. It does not provide general JavaScript transpilation, module lowering, JSX transformation, or polyfills; combine it with the relevant Babel plugins or presets when those are needed.

```ts pmcp-example
import assert from "node:assert/strict";
import { transformSync } from "@babel/core";
import transformTypeScript from "@babel/plugin-transform-typescript";

const result = transformSync(
  `
  const count: number = 0;
  class A {
    declare foo: string;
    bar: string;
  }
  `,
  { plugins: [transformTypeScript] },
);

assert.ok(result?.code);
assert.match(result.code, /const count = 0/);
assert.match(result.code, /class A/);
assert.doesNotMatch(result.code, /declare/);
assert.doesNotMatch(result.code, /foo/);
assert.match(result.code, /bar/);
```

## Babel 8 typed class fields

In Babel 8, an uninitialized typed class field remains a runtime field. Use `declare` for a type-only field that should be removed. Do not carry forward the older Babel 7 `allowDeclareFields` configuration; Babel 8 enables this behavior by default.

The transformed output may represent the remaining uninitialized field as a bare class field such as `foo;`; do not require an explicit `undefined` initializer.

```ts pmcp-example
import assert from "node:assert/strict";
import { transformSync } from "@babel/core";
import transformTypeScript from "@babel/plugin-transform-typescript";

const result = transformSync(
  `class A {
    foo: string | void;
    declare bar: number;
  }`,
  { plugins: [transformTypeScript] },
);

assert.ok(result?.code);
assert.match(result.code, /foo/);
assert.doesNotMatch(result.code, /declare/);
assert.doesNotMatch(result.code, /bar/);
```

## `const enum` optimization

Set `optimizeConstEnums: true` to inline a `const enum` member use.

```ts pmcp-example
import assert from "node:assert/strict";
import { transformSync } from "@babel/core";
import transformTypeScript from "@babel/plugin-transform-typescript";

const result = transformSync(
  `const enum Animals { Fish }
   console.log(Animals.Fish);`,
  {
    plugins: [[transformTypeScript, { optimizeConstEnums: true }]],
  },
);

assert.ok(result?.code);
assert.match(result.code, /console\.log\(0\)/);
assert.doesNotMatch(result.code, /Animals\.Fish/);
```

## Options and configuration mistakes

The plugin options are:

- `allowNamespaces?: boolean`
- `jsxPragma?: string`, defaulting to `React.createElement`
- `jsxPragmaFrag?: string`, defaulting to `React.Fragment`
- `onlyRemoveTypeImports?: boolean`
- `optimizeConstEnums?: boolean`

In Babel 8, `onlyRemoveTypeImports` defaults to `true`. If using TypeScript before 3.8, or not using `verbatimModuleSyntax: true`, explicitly configure `onlyRemoveTypeImports: false`.

Pass options as the second item in a Babel plugin tuple:

```ts
plugins: [[transformTypeScript, { onlyRemoveTypeImports: false }]]
```

Do not use the older preset-oriented `isTSX` or `allExtensions` configuration in Babel 8. Babel 8 uses file extensions plus JSX plugin or preset configuration. For a nonstandard extension, use `ignoreExtensions: true`.

The package is also included in `@babel/preset-typescript`, but installing or using the preset does not add type-checking.

## CommonJS `import = require` caveat

TypeScript's `import alias = require("foo")` form is intended for compilation to CommonJS. Running only this plugin through `transformSync` does not provide that module-compilation context and can report that the form is supported only when compiling modules to CommonJS. Configure the appropriate Babel module transformation as part of the toolchain; the TypeScript plugin alone is not a complete module compiler.

This part is therefore not demonstrated by a standalone example here: the required CommonJS module-compilation setup is outside the package's standalone transform-only behavior covered by this skill.

## Does not cover

This skill does not cover TypeScript type-checking, JSX transformation details, module lowering or complete CommonJS module compilation, polyfills, general ES-feature transpilation, Babel CLI invocation, preset configuration beyond the migration points above, or the complete behavior of every plugin option. Those require the relevant TypeScript or Babel tools and configuration.

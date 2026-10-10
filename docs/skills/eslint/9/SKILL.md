---
name: eslint
description: Configure and run ESLint 9 flat-config workflows, diagnose file selection and ignored paths, interpret CLI results and verify safe fixes. Integrate TypeScript project-aware rules through the installed typescript-eslint package.
---

# ESLint 9 executable lint workflows

Read the installed ESLint, Node and plugin versions. The fixture targets ESLint
9.39.5 with typescript-eslint 8.70.0 and TypeScript 5.9.3. Preserve an existing
configuration's scope; migrating legacy config is a separate task.

[Upstream version support](https://eslint.org/version-support/) lists ESLint 9
as end of life since 2026-08-06. This guide supports an existing pinned 9.x
application during maintenance or migration; it does not recommend installing
that unsupported major in a new project. Prefer a currently supported release
when Node and plugin compatibility allow, and plan existing-pin upgrades
separately from ordinary lint fixes.

## Use flat config deliberately

ESLint 9 uses flat config by default. Define language options, plugins and rule
configuration as objects rather than translating legacy extends strings
mechanically. Recent ESLint 9 versions supply defineConfig and its scoped extends:

```js
import { defineConfig } from "eslint/config";

export default defineConfig({
  files: ["src/**/*.{js,mjs}"],
  rules: { "no-unused-vars": "error" },
});
```

Verify installed-patch support when working on an older 9.x release. An object
containing only ignores represents a global ignore; an ignore on an object with
other configuration keys scopes that object's application. Check the actual
file's effective config before broadening a glob.

```sh
eslint --print-config src/example.js
eslint src --max-warnings=0
```

Missing rules can result from file selection, plugin registration or config
lookup. A parser accepting TypeScript does not enable type-aware rules; those
need project information from typescript-eslint.

## Typed linting

Use a scoped TypeScript config through defineConfig with the installed preset:

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

Keep these files in the intended tsconfig. Out-of-project files need a deliberate
separate untyped config or a narrowly allowed default project; do not load every
workspace file into one fallback project. Use the application's TypeScript
compiler check as well; linting is not a substitute.

## Verify diagnostics and fixes

Run the installed CLI on intended paths. Exit 1 means lint violations; exit 2
means a configuration or execution failure. Report rule identifiers and
locations rather than treating every nonzero exit as the same failure.

Preview an unfamiliar fix with --fix-dry-run and a suitable formatter, review its
scope, then use --fix when the task authorizes the edit. Re-run lint on the written
files. A fix does not necessarily resolve type errors or application behavior.

The fixture checks flat file selection, a typed floating-promise violation,
a bounded fix and clean revalidation while malformed ignored input is skipped.
The formatting rule in that fixture is an existing-rule compatibility check,
not a recommendation to replace the project's formatter.

## Sources

- [ESLint 9 migration](https://eslint.org/docs/latest/use/migrate-to-9.0.0)
- [Configuration files](https://eslint.org/docs/latest/use/configure/configuration-files)
- [Command-line interface](https://eslint.org/docs/latest/use/command-line-interface)
- [Typed linting](https://typescript-eslint.io/getting-started/typed-linting/)

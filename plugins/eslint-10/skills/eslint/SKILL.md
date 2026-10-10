---
name: eslint
description: Configure and run ESLint 10 flat-config workflows, account for file-relative configuration lookup and removed legacy APIs, and verify JavaScript fixes or TypeScript project-aware diagnostics using compatible plugins.
---

# ESLint 10 flat configuration

Read the installed versions and their engine/peer ranges. The fixture targets
ESLint 10.10.0, typescript-eslint 8.70.0 and TypeScript 5.9.3. That ESLint version's
Node range is ^20.19.0, ^22.13.0 or >=24; do not assume every newer odd-numbered
Node release between those ranges is supported.

## Account for major-specific lookup

ESLint 10 requires flat configuration and removes legacy eslintrc support.
Configuration lookup starts from the linted file's directory rather than always
from the process working directory. In a monorepo, inspect the config applying to
each target file before moving config files or changing the invocation root.

```js
import { defineConfig } from "eslint/config";

export default defineConfig(
  { ignores: ["generated/**"] },
  { files: ["src/**/*.js"], rules: { "no-unused-vars": "error" } },
);
```

Use explicit files globs and global ignore objects. --print-config on a real
target and a narrowly scoped CLI invocation reveal configuration-selection issues
more reliably than whether importing eslint succeeds.

## Scope typed configuration

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

Check plugin compatibility with ESLint 10. Parsing TypeScript alone does not
provide the project information required by typed rules. Keep the file within
its intended tsconfig and avoid broad default-project fallbacks that increase
memory or conceal an incorrect project boundary.

Custom plugins may depend on context or SourceCode methods removed in ESLint 10.
Update the plugin's supported API rather than disabling unrelated diagnostics.
The major also changes JSX reference tracking and recommended rules; inspect
new diagnostics during an explicitly requested migration.

## Run and verify

Use the installed CLI. Exit 0 means no failures under the configured thresholds,
1 means lint violations and 2 means configuration/execution failure. Inspect
structured diagnostics and verify --fix output with another lint invocation.
Preserve the project's formatter and typecheck boundaries.

The fixture performs actual flat-config and typed linting, a bounded JavaScript
fix, and clean validation with malformed ignored input excluded. It does not
establish compatibility with every third-party rule or legacy configuration.

## Sources

- [ESLint 10 migration and removed APIs](https://eslint.org/docs/latest/use/migrate-to-10.0.0)
- [Flat configuration](https://eslint.org/docs/latest/use/configure/configuration-files)
- [CLI exit codes and fixes](https://eslint.org/docs/latest/use/command-line-interface)
- [typescript-eslint typed linting](https://typescript-eslint.io/getting-started/typed-linting/)

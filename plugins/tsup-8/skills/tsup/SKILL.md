---
name: tsup
description: Build and diagnose TypeScript library packages using tsup 8, including ESM/CJS exports, declaration files, dependency externalization, and packed consumer verification. Use for an existing tsup build rather than application bundler or migration selection.
---

# tsup 8 library builds

Use the project's installed tsup version and package manager. The fixture targets
tsup 8.5.1; its execution evidence belongs to the generated catalog, not an
assumption that every application configuration has been tested.

[The upstream repository](https://github.com/egoist/tsup) states that tsup is no
longer actively maintained and recommends considering tsdown. Keep an existing
tsup build working when that is the task. Evaluate a migration separately rather
than changing the bundler as part of an ordinary packaging fix.

## Choose the package contract before the build

Inspect package.json, the existing exports map, tsconfig, runtime target, entry
points and consumers. Emit CJS only if consumers need require. Keep Node built-ins
and peer dependencies external. tsup normally externalizes dependencies and peer
dependencies from package.json; use explicit external entries when the packaging
contract requires them. Bundling a dependency deliberately requires checking its
license, runtime assumptions and duplicate-instance behavior.

The following configuration keeps output paths explicit in a type: module package:

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  target: "node22",
  platform: "node",
  dts: true,
  clean: true,
  external: ["node:crypto"],
  outExtension({ format }) {
    return { js: format === "esm" ? ".js" : ".cjs" };
  },
});
```

Keep the export map synchronized with emitted files, including the declarations
that TypeScript associates with each module format:

```json
{
  "type": "module",
  "files": ["dist"],
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "require": {
        "types": "./dist/index.d.cts",
        "default": "./dist/index.cjs"
      }
    }
  }
}
```

Check actual declaration filenames after the build. Do not invent .d.cts files
from an export-map example if the installed configuration emitted something else.
Declare public runtime dependencies and peers in the shipped manifest; an
external import does not make an undeclared dependency available to consumers.

## Diagnose failures at the right boundary

- JavaScript success with declaration failure: run the project's TypeScript
  check and inspect exported types, module resolution and external type imports.
  Bundling JavaScript does not establish that declarations are valid.
- Runtime module errors: compare type, exports, extensions and the actual import
  or require consumer. Do not rewrite an ESM-only dependency into a require call.
- Missing assets or entry points: inspect npm pack output and the files allowlist.
  A workspace import from src can conceal an incomplete published package.
- A React or other singleton peer bundled into the output: confirm externalization
  and compare consumer dependency resolution before adding deduplication aliases.

## Verify the distributable

Build once, inspect npm pack --dry-run --json, then create an actual tarball when
the task changes exports, declarations or packaging. Test an isolated consumer
against that tarball, without workspace aliases or source-file imports.

Check the ESM import and CJS require branches that the package promises. Run a
NodeNext TypeScript consumer for both .mts and .cts when both branches are
published. Browser libraries also need their browser consumer environment;
the Node fixture does not prove browser or native-addon compatibility.

## Sources

- [tsup configuration, formats and dependencies](https://tsup.egoist.dev/)
- [tsup maintenance status and source](https://github.com/egoist/tsup)
- [Node.js package exports](https://nodejs.org/api/packages.html#conditional-exports)
- [TypeScript compiler options for libraries](https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html)

---
name: typescript
description: Configure and troubleshoot TypeScript 5 projects, module resolution, declaration exports, and referenced builds while preserving the project's runtime and build system.
metadata:
  target-version: "5.9.3"
---

# TypeScript 5 development workflow

Use the project's installed compiler and scripts. This skill targets TypeScript
5.9.3; it does not imply compatibility with every 5.x release or the separate
native-preview compiler.

## Choose options for the host

Read the nearest package.json, the complete tsconfig extends chain, and the
existing emitter before changing configuration. Preserve the package manager,
supported runtimes, module format, and strictness policy.

| Execution host                                 | Configuration decision                                                                                                                              |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| JavaScript emitted for Node.js                 | Use a matching Node module mode, such as NodeNext with NodeNext resolution. Package type and .mts/.cts extensions determine ESM/CJS interpretation. |
| Application bundled by Vite or another bundler | Bundler resolution with ESNext or Preserve module mode can match the bundler's import behavior. Keep the project's existing emitter.                |
| Published library                              | Check the emitted JavaScript and declarations from consumer projects; a successful source check alone does not prove package compatibility.         |

NodeNext ESM source imports use the emitted extension, such as ./math.js, even
when the source is math.ts. Bundler resolution permits extensionless relative
imports; do not transfer that assumption into unbundled Node.js output.

TypeScript paths describes resolution for the compiler. It does not rewrite
emitted imports or create runtime aliases. Configure the actual runtime/bundler
when the application needs aliases.

These decisions follow the [compiler-option guide](https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html)
and [module-resolution reference](https://www.typescriptlang.org/docs/handbook/modules/reference.html).

## Make a bounded change

Reproduce the diagnostic with the local compiler and the owning project's
configuration. Use the existing typecheck script, or tsc -p <config> --noEmit when
the project uses tsc directly. Passing source filenames directly to tsc bypasses
normal tsconfig discovery.

Keep runtime data validation separate from TypeScript's compile-time guarantees.
Use narrowing, discriminated unions, or type-only imports to express an existing
contract. Do not hide a resolution or declaration defect behind any, an assertion,
skipLibCheck, or a dependency upgrade.

When resolution is unclear, use tsc -p <config> --traceResolution for the failing
import and inspect its selected package exports condition. Change the narrowest
incorrect option or export, then repeat the owning check.

## Check published declarations through exports

For a single ESM entrypoint, the package may expose:

```json
{
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  }
}
```

Build first and ensure both files exist. A consumer must import the package by
its public name, not by a source path that bypasses exports. Check the packaged
files under the supported consumer resolution modes and execute the public
JavaScript entrypoint in its advertised runtime.

Ship declaration dependencies required by consumers, rather than leaving them
available only through a developer's local installation. The
[declaration-publishing guide](https://www.typescriptlang.org/docs/handbook/declaration-files/publishing.html)
describes how declarations and their dependencies travel with a package.

Declaration files must describe the corresponding JavaScript module format.
Use matching .d.mts/.d.cts when those formats require separate declaration
entrypoints. Dual ESM/CJS output needs checks of both exposed formats; one
NodeNext consumer does not establish CJS compatibility.

For libraries bundled with external dependencies, check imports retained in
declarations and JavaScript. Bundler-only source resolution can accept imports
that break in Node.js consumers.

## Referenced projects

Use the existing reference graph rather than replacing it with one broad source
glob. Referenced projects normally use composite and emit declarations; a
solution tsconfig can contain files: [] and references to the buildable projects.
Run tsc -b <solution> for dependency-order builds. Use noEmit on a separate
consumer check when appropriate, rather than removing outputs that downstream
references require.

Inspect include, rootDir, outDir, declaration outputs, and build-info paths when
a reference is stale or incomplete. Keep generated outputs separate from source.
The [project-reference guide](https://www.typescriptlang.org/docs/handbook/project-references.html)
explains the build contract.

## Completion evidence

Report the compiler version, project configuration checked, and actual commands.
For a library, include declaration consumption through exports and public runtime
imports. Distinguish passing checks, expected negative diagnostics, and unchecked
formats. Do not describe a successful build as proof of all supported platforms.

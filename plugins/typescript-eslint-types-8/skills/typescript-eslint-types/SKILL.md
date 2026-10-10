---
name: typescript-eslint-types
description: "Use @typescript-eslint/types ^8 as the lightweight TypeScript-ESTree AST type package: runtime AST enums plus exported parser, project-service, and AST declarations. It is an internal package, not a parser, runner, CLI, or standalone AST-producing tool."
---

Verified against @typescript-eslint/types@8.70.0 on 2026-09-08. 2 of 2 examples executed.

# @typescript-eslint/types v8

## What this package is

`@typescript-eslint/types` is an internal package containing TypeScript-ESTree AST specifications and related declarations. The v8 entrypoint re-exports:

- `AST_NODE_TYPES` and `AST_TOKEN_TYPES` from the generated AST specification
- declarations from `lib`
- parser options
- TypeScript-ESTree declarations

The package README describes it as an internal package used to reduce dependency cycles and provide lighter-weight runtime packages. It is probably not the public entry point for application code.

This package does not provide a documented parser, CLI, runner, build-step API, or standalone workflow. A plain script can use its runtime enums and type declarations, but parsing and tool execution belong to the surrounding TypeScript-ESLint tooling.

## Runtime enums

`AST_NODE_TYPES` contains values used by AST node `type` properties. `AST_TOKEN_TYPES` contains values used by AST token `type` properties.

Known values include:

```ts
AST_NODE_TYPES.Identifier === 'Identifier'
AST_NODE_TYPES.TSInterfaceDeclaration === 'TSInterfaceDeclaration'
AST_TOKEN_TYPES.Identifier === 'Identifier'
AST_TOKEN_TYPES.Punctuator === 'Punctuator'
```

Use the enum values rather than repeating string literals when checking these discriminants.

```ts pmcp-example
import assert from 'node:assert/strict';
import { AST_NODE_TYPES, AST_TOKEN_TYPES } from '@typescript-eslint/types';

assert.equal(AST_NODE_TYPES.Identifier, 'Identifier');
assert.equal(AST_NODE_TYPES.TSInterfaceDeclaration, 'TSInterfaceDeclaration');
assert.equal(AST_TOKEN_TYPES.Identifier, 'Identifier');
assert.equal(AST_TOKEN_TYPES.Punctuator, 'Punctuator');
```

## Parser option declarations

`ParserOptions` is exported as a type. It supports, among other properties, `ecmaFeatures`, `ecmaVersion`, JSX-related settings, TypeScript decorator and diagnostic settings, project settings, source type, token/range settings, and additional unknown properties through its index signature.

The documented v8 declaration includes these important project-related shapes:

- `project?: string[] | string | boolean | null`
- `projectService?: boolean | ProjectServiceOptions`
- `programs?: Program[] | null`
- `filePath?: string`
- `tsconfigRootDir?: string`
- `extraFileExtensions?: string[]`
- `cacheLifetime?: { glob?: CacheDurationSeconds }`

`ProjectServiceOptions` is also exported as a type. Its fields are:

- `allowDefaultProject?: string[]`
- `defaultProject?: string`
- `maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING?: number`

The following is a type-checking example only; this package does not consume the options or start a project service itself.

```ts pmcp-example
import assert from 'node:assert/strict';
import type { ParserOptions, ProjectServiceOptions } from '@typescript-eslint/types';

const projectService: ProjectServiceOptions = {
  allowDefaultProject: ['*.js'],
  defaultProject: 'tsconfig.json',
  maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 8,
};

const options = {
  filePath: 'example.ts',
  project: 'tsconfig.json',
  projectService,
  ecmaFeatures: { jsx: true },
  tokens: true,
  range: true,
} satisfies ParserOptions;

assert.equal(options.projectService.defaultProject, 'tsconfig.json');
assert.equal(options.ecmaFeatures.jsx, true);
```

## v8 migration traps

### Do not copy an older AST parent assumption

The v8 changelog calls out stricter parent types for the AST. Code written against an older major may assume a broader or less precise parent shape. Update AST visitors and type narrowing to satisfy the v8 declarations instead of forcing older parent assumptions through casts.

### Use `projectService`, not the experimental older name

The v8 changelog says the experimental project-service option was stabilized as `projectService`, and that `EXPERIMENTAL_useSourceOfProjectReferenceRedirect` was removed. Do not carry those experimental option names into v8 `ParserOptions` configuration.

`projectService` may be a boolean or a `ProjectServiceOptions` object. The object form is supported by v8 types; it is not evidence that this package starts or configures the service by itself.

### Do not treat this package as the parser

The package exports declarations and the two runtime enums. It does not document a parsing function or a command to execute a parser. A direct script can assert enum values or type-check option-shaped data, as shown above, but parsing, linting, and project-service behavior must be exercised through the tool that owns those workflows.

## What this skill does not cover

- Parsing source text into an AST
- Traversing or visiting ASTs
- Running ESLint or a TypeScript-ESLint parser
- Starting or configuring a project service at runtime
- The complete member list or exact declarations of every re-exported AST type
- The concrete allowed values of the exported type aliases `EcmaVersion`, `SourceType`, `JSDocParsingMode`, `DebugLevel`, and `CacheDurationSeconds`
- Public-package recommendations beyond the package's documented internal-package warning

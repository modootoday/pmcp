---
name: typescript-eslint-estree
description: Use @typescript-eslint/typescript-estree ^8 to parse TypeScript into ESTree-compatible ASTs, distinguish plain parsing from type-aware services, and avoid v7 configuration shapes.
---

Verified against @typescript-eslint/typescript-estree@8.70.0 on 2026-09-08. 3 of 3 examples executed.

# @typescript-eslint/typescript-estree

## What this package does

`@typescript-eslint/typescript-estree` converts TypeScript source text into an ESTree-compatible AST. Its documented public surface includes:

- `parse(code, options)`, returning a `TSESTree.Program`.
- `parseAndGenerateServices(code, options)`, returning an AST plus parser services.
- `createProgram(configFile, projectDirectory?)`, a helper for creating a TypeScript `Program` for the `programs` option.
- `TSESTree`, the namespace of AST node types.
- `AST_NODE_TYPES` and `AST_TOKEN_TYPES`, whose values are used by AST nodes and tokens.

The v8 package requires Node `^18.18.0 || ^20.9.0 || >=21.1.0` and TypeScript `>=4.8.4 <5.5.0`. Its documented ESLint minimum is `^8.57.0`.

## Basic parsing

Use `parse` when an ESTree-compatible AST is enough:

```ts pmcp-example
import { strict as assert } from 'node:assert';
import { parse } from '@typescript-eslint/typescript-estree';

const ast = parse(`const hello: string = 'world';`, {
  loc: true,
  range: true,
});

assert.equal(ast.type, 'Program');
assert.equal(ast.body.length, 1);
assert.equal(ast.range?.[0], 0);
assert.ok(ast.loc);
```

`loc: true` adds source locations and `range: true` adds character ranges. The returned value is a `TSESTree.Program`.

## AST type and token constants

Use `AST_NODE_TYPES` and `AST_TOKEN_TYPES` rather than copying string values when comparing AST types or token types:

```ts pmcp-example
import { strict as assert } from 'node:assert';
import {
  parse,
  AST_NODE_TYPES,
  AST_TOKEN_TYPES,
} from '@typescript-eslint/typescript-estree';

const ast = parse('const answer = 42;');

assert.equal(ast.type, AST_NODE_TYPES.Program);
assert.equal(AST_TOKEN_TYPES.Identifier, 'Identifier');
```

`TSESTree` is a TypeScript namespace of AST node types rather than a value to inspect at runtime.

## Parser services

Use `parseAndGenerateServices` when the caller needs the AST together with parser services. The documented service surface includes `program`, `esTreeNodeToTSNodeMap`, and `tsNodeToESTreeNodeMap` when configured for type information.

```ts pmcp-example
import { strict as assert } from 'node:assert';
import { parseAndGenerateServices } from '@typescript-eslint/typescript-estree';

const { ast, services } = parseAndGenerateServices(
  `const hello: string = 'world';`,
  {
    filePath: 'example.ts',
    loc: true,
    range: true,
  },
);

assert.equal(ast.type, 'Program');
assert.ok(services);
assert.ok(ast.loc);
assert.ok(ast.range);
```

Plain parsing does not provide type information. Type-aware parsing requires a `project`, `projectService`, or supplied `programs`; rules that need type information cannot obtain it from `parse()` alone.

## Supplying a TypeScript program

`createProgram(configFile, projectDirectory?)` creates a TypeScript `Program` from a TSConfig and is documented as a helper for the `programs` option:

```ts
const program = tsESTree.createProgram('tsconfig.json');
const { ast, services } = parseAndGenerateServices(code, {
  filePath: '/some/path/to/file/foo.ts',
  program,
});
```

This requires a real TSConfig/project and is therefore not a standalone in-memory operation. `filePath` identifies the source file for project-aware parsing.

## v8 migration traps

- Do not use `parserOptions.EXPERIMENTAL_useProjectService`; in v8 the stable name is `parserOptions.projectService`.
- `parserOptions.project` remains available, but v8 documentation prefers `projectService`.
- Do not use the removed `DEPRECATED__createDefaultProgram` isolated-program support. Migrate to `projectService` or `project`.
- Do not use the removed `EXPERIMENTAL_useSourceOfProjectReferenceRedirect`; use `projectService`.
- The option formerly named `automaticSingleRunInference` is now `disallowAutomaticSingleRunInference`. Its default is opt-out.
- Project globs match dot-directories by default in v8.

`projectService` is tied to TypeScript project/TSConfig discovery, not just a source string. Its documented configuration includes `allowDefaultProject`, `defaultProject`, and `loadTypeScriptPlugins`, for example:

```ts
projectService: {
  allowDefaultProject: ['*.js'],
  defaultProject: 'tsconfig.json',
  loadTypeScriptPlugins: false,
}
```

The project service can create persistent file watchers. It defaults to `false` specifically to avoid operations that prevent CLI processes from exiting.

## What this skill does not cover

This skill does not cover the complete export list, the full `ParseOptions` schema, detailed AST node shapes, TypeScript compiler APIs, or the surrounding ESLint parser configuration. It also does not provide a runnable project-service or `createProgram` example because those require a TSConfig/project and filesystem-backed project discovery. The research does not document how to configure every type-aware option or every parser-service mapping operation.

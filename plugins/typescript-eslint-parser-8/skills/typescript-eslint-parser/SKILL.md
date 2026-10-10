---
name: typescript-eslint-parser
description: Use @typescript-eslint/parser ^8.0.0 directly or as the parser behind ESLint. Covers standalone parsing, complete parse results, isolated parser options, v8 Project Service naming, and boundaries around type-aware parsing.
---

Verified against @typescript-eslint/parser@8.70.0 on 2026-09-08. 3 of 3 examples executed.

# @typescript-eslint/parser v8

`@typescript-eslint/parser` parses TypeScript into ESLint-compatible nodes and can provide backing TypeScript programs. It is an ESLint parser, not a compiler or standalone lint runner. Its direct API is useful for parsing and inspecting ASTs; lint rules and ESLint configuration are exercised by ESLint itself.

## Direct parsing

Import the package by name and call `parse` with TypeScript source. The result is an ESLint-compatible AST. `filePath` is a parser option and is useful when parser behavior depends on the apparent file name.

```ts pmcp-example
import * as assert from 'node:assert/strict';
import * as parser from '@typescript-eslint/parser';

const ast = parser.parse('let x: number = 1;', {
  filePath: 'example.ts',
});

assert.equal(ast.type, 'Program');
assert.equal(ast.body.length, 1);
assert.equal(ast.body[0].type, 'VariableDeclaration');
assert.equal(ast.body[0].declarations[0].id.type, 'Identifier');
assert.equal(ast.body[0].declarations[0].id.typeAnnotation.type, 'TSTypeAnnotation');
```

`parse` accepts either source text or a TypeScript `SourceFile`. For ordinary standalone parsing, pass source text and parser options.

## `parseForESLint`

Use `parseForESLint` when the consumer needs the complete parser result rather than only the AST. The result contains `ast`, `services`, `visitorKeys`, and `scopeManager`.

```ts pmcp-example
import * as assert from 'node:assert/strict';
import * as parser from '@typescript-eslint/parser';

const result = parser.parseForESLint('const answer: number = 42;', {
  filePath: 'example.ts',
});

assert.equal(result.ast.type, 'Program');
assert.ok(result.services);
assert.ok(result.visitorKeys);
assert.ok(result.scopeManager);
assert.equal(result.ast.body[0].type, 'VariableDeclaration');
```

The parser can expose TypeScript-backed services when configured for type-aware parsing. Type-aware parsing requires `projectService` or `project`; if `programs` is supplied, it must contain every file being linted. A direct script should not assume that type information exists merely because the input is TypeScript.

## Isolated parsing with `withoutProjectParserOptions`

`withoutProjectParserOptions` removes project-based parser settings so parsing can be performed without a TypeScript project. Use it when a caller may provide type-aware options but this parse must remain isolated. Do not assume that unrelated options, such as `tsconfigRootDir`, are removed.

```ts pmcp-example
import * as assert from 'node:assert/strict';
import * as parser from '@typescript-eslint/parser';

const isolated = parser.withoutProjectParserOptions({
  filePath: 'example.ts',
  project: './tsconfig.json',
  projectService: true,
  tsconfigRootDir: '/tmp/project',
});

assert.equal(isolated.project, undefined);
assert.equal(isolated.projectService, undefined);
assert.equal(isolated.filePath, 'example.ts');
assert.equal(isolated.tsconfigRootDir, '/tmp/project');

const result = parser.parseForESLint('const value: string = "ok";', isolated);
assert.equal(result.ast.type, 'Program');
```

This is particularly important for direct invocation: type-aware options are not self-contained, and project-backed parsing needs the relevant project configuration or supplied programs.

## Project-backed parsing

`createProgram(configFile, projectDirectory?)` creates a TypeScript `Program` from a configuration file. The resulting program can be supplied through parser options where appropriate. This operation requires a real `tsconfig.json` and project files, so it is normally used by an ESLint or tooling process rather than a self-contained script. A standalone example cannot create those files under the execution constraints for this skill.

The parser also supports documented options including `project`, `programs`, `projectService`, `tsconfigRootDir`, `lib`, `ecmaVersion`, `ecmaFeatures`, `jsxPragma`, `jsxFragmentName`, `extraFileExtensions`, `jsDocParsingMode`, and controls for unsupported TypeScript versions.

## v8 configuration mistake: Project Service spelling

In v8, use:

```js
parserOptions: { projectService: true }
```

The older experimental spelling is:

```js
parserOptions: { EXPERIMENTAL_useProjectService: true }
```

Do not copy the older experimental name into new v8 configuration. `project` remains supported, while `projectService` is the stable v8 Project Service option. Project Service automatically uses the nearest `tsconfig.json`, can type-check JavaScript without `allowJs`, and is an alternative to `project`.

## ESLint integration

This package supplies the parser; it does not define `describe`, `it`, or `expect`, and it does not run lint rules. The rest of the workflow is run by ESLint.

The older legacy ESLint shape still commonly appears as:

```js
module.exports = {
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  root: true,
};
```

The parser entry is required in that setup; otherwise ESLint parses TypeScript as JavaScript and errors. With flat config, the parser is configured under `languageOptions`; a typical v8-era shape is:

```js
export default [{
  languageOptions: {
    parserOptions: { projectService: true },
  },
}];
```

As of v7/v8, the recommended package is generally `typescript-eslint`; flat-config users usually do not need to install `@typescript-eslint/parser` explicitly when using that package.

## Other exports

The v8 entry point also exports `clearCaches`, `version`, and `meta`, along with parser-related types. `clearCaches` is for clearing parser caches in a long-lived tooling process. `version` and `meta` provide package/parser metadata. TypeScript types such as `ParserOptions`, `ParserServices`, `ParserServicesWithTypeInformation`, and `ParserServicesWithoutTypeInformation` are useful to TypeScript consumers but do not produce runtime values.

## Does not cover

- ESLint rule execution, CLI invocation, or complete ESLint configuration.
- The contents or layout of a real `tsconfig.json` project.
- Which files a particular TypeScript program includes.
- Detailed AST node schemas beyond the directly demonstrated fields.
- TypeScript compiler behavior or type-checking semantics.
- Performance tuning, cache internals, or the full behavior of every parser option.
- A standalone `createProgram` example, because it requires project files that are unavailable to the self-contained example runner.

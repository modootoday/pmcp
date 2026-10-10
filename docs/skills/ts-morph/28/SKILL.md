---
name: ts-morph
description: Use ts-morph 28.x for in-memory TypeScript project analysis, AST navigation and manipulation, type checking, printing, diagnostics, and emission.
---

Verified against ts-morph@28.0.0 on 2026-09-07. 8 of 8 examples executed.

# ts-morph 28.x

## Version boundary

This skill targets `ts-morph` `^28.0.0`. Version 28 is based on TypeScript 6.0 and has breaking changes from the TypeScript 5.9-based 27.x line. The release notes do not enumerate the individual migration changes, so do not assume that an older-major API shape remains valid.

Version 28 adds the standalone `printStructure` function. Prefer it when a structure needs to be rendered without first creating a `Project` or AST node.

## Project setup and virtual source files

Create a project with `new Project()`. Compiler options can be passed through the constructor; the documented example uses `ScriptTarget.ES3`.

Source files can be created from text, a structure, or a writer callback. Newly created source files are in memory and are not written to disk unless `save()` or `saveSync()` is called.

```ts pmcp-example
import { strict as assert } from "node:assert";
import { Project, ScriptTarget } from "ts-morph";

const project = new Project({
  compilerOptions: { target: ScriptTarget.ES3 },
});

const sourceFile = project.createSourceFile(
  "src/example.ts",
  "export const answer: number = 42;\n",
);

assert.equal(sourceFile.getVariableDeclarationOrThrow("answer").getType().getText(), "number");
assert.equal(project.getSourceFiles().length, 1);
```

A writer callback is also supported:

```ts pmcp-example
import { strict as assert } from "node:assert";
import { Project } from "ts-morph";

const project = new Project();
const sourceFile = project.createSourceFile("src/generated.ts", writer => {
  writer
    .writeLine("import * as ts from 'typescript';")
    .blankLine()
    .writeLine("export class MyClass {}\n");
});

assert.equal(sourceFile.getClassOrThrow("MyClass").getName(), "MyClass");
assert.match(sourceFile.getFullText(), /import \* as ts/);
```

## Finding source files and navigating nodes

Use `project.getSourceFiles()` for all loaded files. It accepts a glob or an array of globs; the documented array form supports negation such as `!src/test/**/*.ts`. `getSourceFile()` accepts a path or a predicate.

On a source file, use `getClasses()`, `getClass()`, or a predicate to find classes. For general traversal, use `sourceFile.forEachDescendant(...)`.

```ts pmcp-example
import { strict as assert } from "node:assert";
import { Project } from "ts-morph";

const project = new Project();
project.createSourceFile("src/Models/Person.ts", "export class Person {}\n");
project.createSourceFile("src/test/Fixture.ts", "export class Fixture {}\n");

const modelFiles = project.getSourceFiles("src/**/*.ts");
const nonTestFiles = project.getSourceFiles(["src/**/*.ts", "!src/test/**/*.ts"]);
const personFile = project.getSourceFile("src/Models/Person.ts");
const fileWithOneClass = project.getSourceFile(file => file.getClasses().length === 1);

assert.equal(modelFiles.length, 2);
assert.equal(nonTestFiles.length, 1);
assert.equal(personFile?.getClass("Person")?.getName(), "Person");
assert.equal(fileWithOneClass?.getClasses()[0].getName(), "Person");
```

## AST manipulation

Classes and members can be added, changed, and removed directly. The class API includes singular and plural add/insert methods; use insertion methods when position matters.

```ts pmcp-example
import { strict as assert } from "node:assert";
import { Project } from "ts-morph";

const project = new Project();
const sourceFile = project.createSourceFile("src/models.ts", "");
const classDeclaration = sourceFile.addClass({ name: "ClassName" });

classDeclaration.setExtends("BaseClass");
classDeclaration.addImplements(["Named", "Aged"]);
const method = classDeclaration.addMethod({
  isStatic: true,
  name: "myMethod",
  returnType: "string",
});
const property = classDeclaration.addProperty({
  isStatic: true,
  name: "prop",
  type: "string",
});

assert.match(sourceFile.getFullText(), /class ClassName extends BaseClass/);
assert.match(sourceFile.getFullText(), /static myMethod\(\): string/);
assert.match(sourceFile.getFullText(), /static prop: string/);

method.remove();
property.remove();
assert.doesNotMatch(sourceFile.getFullText(), /myMethod|prop/);

classDeclaration.remove();
assert.equal(sourceFile.getClasses().length, 0);
```

## Type checking and diagnostics

Get the project type checker with `project.getTypeChecker()`. For a call-like node, `getResolvedSignature()` resolves the call signature. Pre-emit diagnostics are available from either the project or an individual source file. Diagnostic source files may be absent, so treat `diagnostic.getSourceFile()` as `SourceFile | undefined`.

```ts pmcp-example
import { strict as assert } from "node:assert";
import { Project, Node } from "ts-morph";

const project = new Project();
const sourceFile = project.createSourceFile(
  "src/check.ts",
  "function add(a: number, b: number): number { return a + b; }\nconst result = add(1, 2);\n",
);

const call = sourceFile.getDescendants().find(Node.isCallExpression);
assert.ok(call);

const signature = project.getTypeChecker().getResolvedSignature(call);
assert.ok(signature);
assert.equal(signature.getReturnType().getText(), "number");
assert.equal(project.getPreEmitDiagnostics().length, 0);
assert.equal(sourceFile.getPreEmitDiagnostics().length, 0);
```

Use `project.formatDiagnosticsWithColorAndContext(diagnostics)` to format diagnostics for display. The underlying compiler object is available as `typeChecker.compilerObject`, but it is discarded whenever manipulation occurs; do not retain and reuse it across mutations.

## Standalone structure printing

`printStructure` is a 28.0.0 standalone export. It accepts a structure and returns TypeScript text without requiring a project.

```ts pmcp-example
import { strict as assert } from "node:assert";
import { printStructure, StructureKind } from "ts-morph";

const code = printStructure({
  kind: StructureKind.Class,
  name: "MyClass",
  isExported: true,
  properties: [{ name: "myProp", type: "string" }],
  methods: [{
    name: "myMethod",
    parameters: [{ name: "param", type: "number" }],
    returnType: "void",
  }],
});

assert.match(code, /export class MyClass/);
assert.match(code, /myProp: string/);
assert.match(code, /myMethod\(param: number\): void/);
```

## Emitting without filesystem output

`project.emitToMemory()` generates output without writing files. `emit()` and `emitSync()` are the explicit JavaScript/declaration emission APIs; `emitSync()` is documented as slow. Configure `outDir` and `declaration` through project compiler options when generating those outputs.

```ts pmcp-example
import { strict as assert } from "node:assert";
import { Project } from "ts-morph";

const project = new Project({
  compilerOptions: { outDir: "dist", declaration: true },
});
project.createSourceFile("MyFile.ts", "export const num: number = 1;\n");

const result = project.emitToMemory();
const files = result.getFiles();

assert.ok(files.length >= 2);
assert.ok(files.some(file => file.text.includes("const num")));
assert.ok(files.some(file => file.text.includes("declare const num")));
```

## Utilities

`Node.isClassDeclaration(node)` is a type guard for narrowing nodes. `printNode(compilerNode)` prints an underlying compiler node. `getCompilerOptionsFromTsConfig(path)` reads and parses a tsconfig path and returns `{ options, errors }`; it requires an actual readable file path, so it is not demonstrated in the filesystem-free examples above.

```ts pmcp-example
import { strict as assert } from "node:assert";
import { Node, Project, printNode } from "ts-morph";

const project = new Project();
const sourceFile = project.createSourceFile("src/node.ts", "class Example {}\n");
const node = sourceFile.getClasses()[0];

assert.equal(Node.isClassDeclaration(node), true);
assert.match(printNode(node.compilerNode), /class Example/);
```

## Persistence boundary

Manipulation and inspection can remain entirely in memory. Filesystem persistence is explicit: use `await project.save()`, `await sourceFile.save()`, or `sourceFile.saveSync()`. JavaScript/declaration generation is also explicit through `emit()`, `emitSync()`, or `emitToMemory()`.

Do not assume that `createSourceFile()` or AST edits automatically save files. Do not use runner globals such as `describe`, `it`, or `expect`; ts-morph exposes ordinary programmatic APIs rather than a package-owned runner or CLI.

## Not covered

- Individual TypeScript 6.0 migration changes beyond the fact that version 28 is a breaking TypeScript 6.0 release.
- APIs not shown by the supplied research, including detailed writer, structure, compiler-option, and node-manipulation variants.
- The exact formatting of every printed structure or emitted file.
- Filesystem-backed examples for `save()`, `saveSync()`, or `getCompilerOptionsFromTsConfig()`.
- Any ts-morph runner, CLI, mandatory build step, or framework integration; the supplied research describes none.

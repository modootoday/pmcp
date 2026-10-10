---
name: typescript-eslint-utils
description: Use @typescript-eslint/utils ^8.0.0 to author typed custom ESLint rules, work with TypeScript-ESTree node types, and access parser services from rules running under ESLint.
---

Verified against @typescript-eslint/utils@8.70.0 on 2026-09-08. 3 of 3 examples executed.

# @typescript-eslint/utils

## What this package is

`@typescript-eslint/utils` is a library for writing custom ESLint rules and plugins in TypeScript. It provides AST types and constants, ESLint rule types, rule factories, and parser-service types. It is not an ESLint CLI or configuration runner.

The documented top-level exports include:

- `AST_NODE_TYPES`
- `AST_TOKEN_TYPES`
- `ASTUtils`
- `ESLintUtils`
- `JSONSchema`
- `ParserServices`
- `TSESLint`
- `TSESLintScope`
- `TSESTree`

Use public package exports rather than imports from `dist` or other internal paths.

## Creating a rule

Use `ESLintUtils.RuleCreator` for a typed custom rule. Its argument converts the rule name into a documentation URL, and the factory infers valid message IDs from `meta.messages`.

```ts pmcp-example
import assert from 'node:assert/strict';
import { ESLintUtils } from '@typescript-eslint/utils';

const createRule = ESLintUtils.RuleCreator(
  name => `https://typescript-eslint.io/rules/${name}`,
);

const rule = createRule({
  name: 'demo-rule',
  meta: {
    docs: { description: 'Demonstrates a rule.' },
    messages: { found: 'Found it.' },
    type: 'suggestion',
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    return {
      Identifier(node) {
        if (node.name === 'bad') {
          context.report({ messageId: 'found', node });
        }
      },
    };
  },
});

assert.equal(rule.meta.messages.found, 'Found it.');
const reports: unknown[] = [];
const visitors = rule.create({
  report(problem: unknown) {
    reports.push(problem);
  },
} as never);

visitors.Identifier({ type: 'Identifier', name: 'bad' } as never);
assert.equal(reports.length, 1);
```

`ESLintUtils.RuleCreator.withoutDocs` creates a rule without requiring a documentation URL. Use it when the rule intentionally has no documentation metadata requirement.

```ts pmcp-example
import assert from 'node:assert/strict';
import { ESLintUtils } from '@typescript-eslint/utils';

const rule = ESLintUtils.RuleCreator.withoutDocs({
  meta: {
    messages: { notice: 'Notice.' },
    type: 'suggestion',
    schema: [],
  },
  create() {
    return {};
  },
});

assert.equal(rule.meta.messages.notice, 'Notice.');
assert.deepEqual(rule.create({} as never), {});
```

Rules themselves are executed by ESLint. A plain script can construct and call a rule visitor as above, but it does not provide ESLint's complete context or traversal.

## AST node types

`AST_NODE_TYPES` contains the values used by TypeScript-ESTree node `type` fields. `TSESTree.Node` is the discriminated union for those nodes, so switching on `node.type` narrows the node type in TypeScript.

```ts pmcp-example
import assert from 'node:assert/strict';
import { AST_NODE_TYPES, TSESTree } from '@typescript-eslint/utils';

function describeNode(node: TSESTree.Node): string {
  switch (node.type) {
    case AST_NODE_TYPES.Literal:
      return `Literal value ${node.raw}`;
    default:
      return 'unknown';
  }
}

const node = {
  type: AST_NODE_TYPES.Literal,
  value: 42,
  raw: '42',
} as TSESTree.Literal;

assert.equal(describeNode(node), 'Literal value 42');
```

The same public package import can provide `TSESTree`, `TSESLint`, and the other exported namespaces. Do not use old internal paths such as `@typescript-eslint/utils/dist/ts-eslint`.

A documented named subpath is available for the ESLint type surface:

```ts
import { RuleModule } from '@typescript-eslint/utils/ts-eslint';
```

Prefer the public package and documented subpaths; package `exports` hide internal `dist` files.

## Parser services and typed rules

Inside a rule running with the TypeScript parser, call `ESLintUtils.getParserServices(context)`. The returned services include:

- `program`
- `esTreeNodeToTSNodeMap`
- `tsNodeToESTreeNodeMap`
- type-checker wrappers such as `getTypeAtLocation` and `getSymbolAtLocation` when type checking is enabled

For example, a typed rule can obtain a TypeScript type and inspect its symbol:

```ts
const services = ESLintUtils.getParserServices(context);
const type = services.getTypeAtLocation(node.right);

if (type.symbol.flags & ts.SymbolFlags.Enum) {
  context.report({ messageId: 'loopOverEnum', node: node.right });
}
```

This is not standalone type analysis. ESLint must invoke the rule with the TypeScript parser and an appropriate type-checking configuration. A plain `bun example.ts` script cannot provide the parser context or parser services, so this part must be exercised through ESLint.

## v8 compatibility notes

In v8, the `ESLint` export changed from the legacy ESLint class to `FlatESLint`. Code that needs the legacy eslintrc-config class must import `LegacyESLint` instead:

```ts
// v8 legacy class
import { LegacyESLint } from '@typescript-eslint/utils';
```

Do not mechanically preserve older examples that import `ESLint` when they specifically require the legacy class.

The v6 migration already moved consumers away from deep `dist` imports. Use:

```ts
import { TSESLint } from '@typescript-eslint/utils';
```

rather than:

```ts
import * as TSESLint from '@typescript-eslint/utils/dist/ts-eslint';
```

## Testing and adjacent configuration

This package does not run rules or provide the complete test runner experience. The documented replacement for ESLint core's `RuleTester` is `@typescript-eslint/rule-tester`.

In v8, when a rule test has multiple possible fix passes, its `output` is an array containing the output for each pass, for example:

```ts
output: ['const b = 1;', 'const c = 1;']
```

`projectService: true` is also a v8 configuration name replacing `EXPERIMENTAL_useProjectService`, but it belongs to parser/ESLint configuration, not to a standalone `@typescript-eslint/utils` API.

## What this skill does not cover

- Complete ESLint configuration or CLI usage.
- Running a rule over source files.
- The full `@typescript-eslint/rule-tester` API.
- TypeScript parser configuration, project-service configuration, or project files.
- The behavior of the additional exported namespaces beyond the AST and rule-authoring surfaces described above.
- Undocumented internal `dist` modules or unsupported deep imports.

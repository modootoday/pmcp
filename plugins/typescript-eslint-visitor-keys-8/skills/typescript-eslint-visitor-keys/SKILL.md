---
name: typescript-eslint-visitor-keys
description: Use @typescript-eslint/visitor-keys ^8.0.0 to read TypeScript-ESTree visitor-key definitions and obtain keys for AST nodes.
---

Verified against @typescript-eslint/visitor-keys@8.70.0 on 2026-09-08. 2 of 2 examples executed.

# @typescript-eslint/visitor-keys

## Scope

`@typescript-eslint/visitor-keys` provides visitor keys for the TypeScript-ESTree AST. Version `^8.0.0` exposes these named exports from the package root:

- `getKeys`
- `visitorKeys`
- `VisitorKeys` (a TypeScript type alias, not a runtime value)

The package is marked as an internal monorepo package, and its README says that users likely do not want to use it directly. It has no documented CLI or build-step API. Use its ordinary programmatic exports from a Node/Bun script when direct access is appropriate.

The package requires Node `^18.18.0 || ^20.9.0 || >=21.1.0`.

## `visitorKeys`

`visitorKeys` is an ESLint visitor-key map extended with TypeScript-ESTree keys. A map entry associates an AST node type with the property names containing child nodes. The arrays are intentionally ordered in source-code visitation order. **Do not sort them alphabetically.**

Examples of v8 entries include:

```ts
visitorKeys.CallExpression
// ['callee', 'typeArguments', 'arguments']

visitorKeys.ImportExpression
// ['source', 'options']

visitorKeys.TSConditionalType
// ['checkType', 'extendsType', 'trueType', 'falseType']

visitorKeys.TSTypeReference
// ['typeName', 'typeArguments']
```

Use the map by node type when traversing an AST. A missing or `undefined` entry means this package does not provide child-property names for that node type; do not assume every arbitrary string is present.

```ts pmcp-example
import assert from 'node:assert/strict';
import { visitorKeys } from '@typescript-eslint/visitor-keys';

assert.deepEqual(visitorKeys.CallExpression, [
  'callee',
  'typeArguments',
  'arguments',
]);
assert.deepEqual(visitorKeys.ImportExpression, ['source', 'options']);
assert.deepEqual(visitorKeys.TSConditionalType, [
  'checkType',
  'extendsType',
  'trueType',
  'falseType',
]);
assert.deepEqual(visitorKeys.TSTypeReference, ['typeName', 'typeArguments']);
```

## `getKeys`

`getKeys` is a typed alias of `eslint-visitor-keys`'s `getKeys`. Its TypeScript signature accepts a `TSESTree.Node` and returns a readonly string array:

```ts
(node: TSESTree.Node) => readonly string[]
```

It is a function export, not a parser and not a complete AST traversal function. Supply it with an AST node obtained from elsewhere, then use the returned property names to discover that node's properties.

For an identifier-shaped node containing `type` and `name`, the function returns those property names:

```ts pmcp-example
import assert from 'node:assert/strict';
import { getKeys } from '@typescript-eslint/visitor-keys';

assert.equal(typeof getKeys, 'function');

const node = { type: 'Identifier', name: 'value' } as never;
assert.deepEqual(getKeys(node), ['type', 'name']);
```

## v8 migration hazards

Do not copy visitor-key shapes from older `@typescript-eslint/visitor-keys` versions:

- v7 represented enum declarations as `TSEnumDeclaration: ['id', 'members']`; v8 uses `TSEnumDeclaration: ['id', 'body']` and adds `TSEnumBody: ['members']`.
- v7 represented `TSMappedType` with `['nameType', 'typeParameter', 'typeAnnotation']`; v8 splits this into `['key', 'constraint', 'nameType', 'typeAnnotation']`.
- Older v5 code used `typeParameters`; v8 uses `typeArguments`.
- Older v5 code used `superTypeParameters`; v8 uses `superTypeArguments`.
- Older v5 code used `TSImportType.parameter`; v8 uses `TSImportType.argument`.

These are visitor-property names, so using a legacy shape can silently skip children or look for properties that are no longer present. Preserve the order supplied by v8.

## TypeScript usage

`VisitorKeys` is the type alias:

```ts
type VisitorKeys = Record<string, readonly string[] | undefined>;
```

It describes the shape of the exported map and is available for type annotations. It is not a runtime constructor or value.

## What this skill does not cover

- Parsing source text into a TypeScript-ESTree AST.
- A complete AST traversal implementation.
- ESLint rules, parser configuration, or runner APIs.
- The full contents of the visitor-key map beyond the entries and version differences described above.
- Compatibility details for package versions outside `^8.0.0`.
- Any CLI or build-step interface; none is documented by the supplied research.

Sources: [package index](https://raw.githubusercontent.com/typescript-eslint/typescript-eslint/v8.0.0/packages/visitor-keys/src/index.ts), [README](https://raw.githubusercontent.com/typescript-eslint/typescript-eslint/v8.0.0/packages/visitor-keys/README.md), [package metadata](https://raw.githubusercontent.com/typescript-eslint/typescript-eslint/v8.0.0/packages/visitor-keys/package.json), [get-keys implementation](https://raw.githubusercontent.com/typescript-eslint/typescript-eslint/v8.0.0/packages/visitor-keys/src/get-keys.ts), [v7 visitor keys](https://raw.githubusercontent.com/typescript-eslint/typescript-eslint/v7.18.0/packages/visitor-keys/src/visitor-keys.ts), [v5 visitor keys](https://raw.githubusercontent.com/typescript-eslint/typescript-eslint/v5.62.0/packages/visitor-keys/src/visitor-keys.ts).

---
name: css-tree
description: Use css-tree 3.x to parse, traverse, transform, generate, and lex CSS ASTs. Covers the v3 AST/API changes that commonly break v2-era code.
---

Verified against css-tree@3.2.1 on 2026-09-08. 6 of 6 examples executed.

# css-tree 3.x

## Scope

This skill targets `css-tree` versions in `^3.0.0` (the researched documentation currently shows 3.2.1). Import the package by name:

```ts
import * as csstree from 'css-tree';
```

The package also exposes subpath exports including `css-tree/parser`, `css-tree/tokenizer`, `css-tree/selector-parser`, `css-tree/generator`, `css-tree/walker`, `css-tree/convertor`, `css-tree/lexer`, `css-tree/definition-syntax`, and related data/utilities. Prefer the top-level API when it provides the operation you need.

## Parse and generate

`parse(source[, options])` creates an AST. `generate(ast[, options])` serializes an AST back to CSS. Parsing can be directed at a specific grammar context, such as `selector`, `value`, or `condition`.

```ts pmcp-example
import assert from 'node:assert/strict';
import { generate, parse } from 'css-tree';

const ast = parse('.example { world: "!" }');
assert.equal(generate(ast), '.example{world:"!"}');
```

Useful parsing options documented by the package include:

- `context`
- `atrule`
- `positions`
- `onComment`
- `onToken`
- `onParseError`
- `filename`, `offset`, `line`, and `column`
- `parseAtrulePrelude`
- `parseRulePrelude`
- `parseValue`
- `parseCustomProperty`

For a fragment rather than a complete stylesheet, provide the appropriate context:

```ts pmcp-example
import assert from 'node:assert/strict';
import { generate, parse } from 'css-tree';

const selector = parse('.foo.bar', {
    context: 'selector',
    positions: true
});

assert.equal(generate(selector), '.foo.bar');
assert.equal(selector.type, 'Selector');
assert.ok(selector.loc);
```

## Walk and mutate ASTs

`walk(ast, fn)` is shorthand for `walk(ast, { enter: fn })`. A callback receives `(node, item, list)`. The options form also supports `enter`, `leave`, `visit`, and `reverse`.

`List` fields such as `first` and `size` are getters. Do not treat them as the older mutable fields shown in v2-era code.

```ts pmcp-example
import assert from 'node:assert/strict';
import { generate, parse, walk } from 'css-tree';

const ast = parse('.example { world: "!" }');

walk(ast, (node) => {
    if (node.type === 'ClassSelector' && node.name === 'example') {
        node.name = 'hello';
    }
});

assert.equal(generate(ast), '.hello{world:"!"}');
```

To remove nodes, use the containing list and the callback's `item`:

```ts pmcp-example
import assert from 'node:assert/strict';
import { generate, parse, walk } from 'css-tree';

const ast = parse(`
    .a { foo: 1; bar: 2; }
    .b { bar: 3; baz: 4; }
`);

walk(ast, (node, item, list) => {
    if (node.type === 'Declaration' && node.property === 'bar' && list) {
        list.remove(item);
    }
});

assert.equal(generate(ast), '.a{foo:1}.b{baz:4}');
```

## Find nodes

The top-level API also provides `find(ast, fn)`, `findLast(ast, fn)`, and `findAll(ast, fn)` for predicate-based lookup. Use these when you need a result rather than an in-place traversal.

```ts pmcp-example
import assert from 'node:assert/strict';
import { find, findAll, findLast, parse } from 'css-tree';

const ast = parse('.a { color: red } .b { color: blue }');
const isClass = (node) => node.type === 'ClassSelector';

assert.equal(find(ast, isClass).name, 'a');
assert.equal(findLast(ast, isClass).name, 'b');
assert.deepEqual(findAll(ast, isClass).map((node) => node.name), ['a', 'b']);
```

## Lexer

The top-level `lexer` can match a parsed value against a property grammar. `matchProperty(property, ast)` returns a match result. Use `isType(node, type)` to test a node and `getTrace(node)` to inspect the grammar trace.

```ts pmcp-example
import assert from 'node:assert/strict';
import { lexer, parse } from 'css-tree';

const ast = parse('red 1px solid', { context: 'value' });
const matchResult = lexer.matchProperty('border', ast);
const first = ast.children.first;

assert.equal(matchResult.isType(first, 'color'), true);
assert.ok(matchResult.getTrace(first));
```

## v3 AST and syntax changes

Code written against v2-era examples needs particular care:

- v3 adds support for `@container`, `@starting-style`, `@scope`, `@position-try`, and `@layer`, plus `layer`, `layer()`, and `supports()` in `@media`.
- New AST node types include `Layer`, `LayerList`, `Feature`, `FeatureRange`, `FeatureFunction`, `Condition`, `GeneralEnclosure`, and `SupportsDeclaration`.
- Query conditions can be parsed with `parse('...', { context: 'condition', kind: 'media' })`.
- `MediaQuery` now has `modifier`, `mediaType`, and `condition`; its shape is not the older shape.
- `MediaFeature` is now `Feature` with `kind: 'media'`.
- `Parentheses` is replaced by `SupportsDeclaration` / `Condition` for `@supports`.
- `Block` no longer includes `{` and `}`. `Atrule` and `Rule` include them when they have a block.
- `Ratio` parts are nodes, can be functions, can contain any number of parts, and may have an omitted right part during construction or transformation.
- `TokenStream` has `lookupTypeNonSC()`; generic `<dashed-ident>` is supported.

## v2 compatibility traps

Do not copy these older assumptions into v3 code:

- v2's ESM/CommonJS dual-support examples and standalone subpath imports may still appear in code, but verify the v3 package export you intend to use.
- `Lexer#matchDeclaration()` was removed.
- `SyntaxError` moved to `parse.SyntaxError`.
- `TokenStream#skipWS()` and `getTokenLength()` were removed.
- `List` fields became getters, including `list.first` and `list.size`; do not use the old field shape.

## Plain-script boundary

The parser, walker, generator, and lexer are usable directly from a Node or browser module. They do not require a test runner, CSS build step, or framework globals. The browser-global form requires the shipped bundle (`dist/csstree.js` or `dist/csstree.esm.js`) and a browser script environment.

## Not covered

This skill does not cover the detailed AST schema for every CSS grammar node, the complete lexer-definition API, tokenizer internals, selector-parser internals, generator options, convertors, definition-syntax utilities, browser bundling configuration, or APIs not demonstrated or described by the supplied research.

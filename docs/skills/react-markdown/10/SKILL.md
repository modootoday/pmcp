---
name: react-markdown
description: Use react-markdown ^10.0.0 correctly as an ESM-only React 18+ component, including synchronous, asynchronous, plugin, filtering, URL, and migration guidance.
---

Verified against react-markdown@10.1.0 on 2026-09-08. 3 of 3 examples executed.

# react-markdown

## Version and runtime

This skill targets `react-markdown` `^10.0.0`, meaning the 10.x release line.

- The package is ESM-only.
- Node.js 16+ and React 18+ are required.
- The default export is `Markdown`.
- Named exports include `MarkdownAsync`, `MarkdownHooks`, and `defaultUrlTransform`.
- Type exports include `AllowElement`, `Components`, `ExtraProps`, `HooksOptions`, `Options`, and `UrlTransform`.

Import it with ESM syntax:

```ts pmcp-example
import assert from 'node:assert/strict'
import React from 'react'
import Markdown, {defaultUrlTransform} from 'react-markdown'

const element = Markdown({children: '# Hello'})

assert.equal(React.isValidElement(element), true)
assert.equal(typeof defaultUrlTransform, 'function')
```

`react-markdown` is a React component, not a standalone Markdown-to-string converter. In an application, render it through React, for example with `createRoot(...).render(...)`. A direct script can still call the component function and inspect that it produces a React element, as in the example above; it does not produce HTML text.

## Basic rendering

Pass Markdown as the `children` option:

```tsx
<Markdown>{'# Hi, *Pluto*!'}</Markdown>
```

The documented component signature is `Markdown(options: Options): ReactElement`.

## Options and plugins

`Options` includes:

- `children`
- `components`
- `remarkPlugins`
- `rehypePlugins`
- `allowedElements`
- `disallowedElements`
- `skipHtml`
- `unwrapDisallowed`
- `remarkRehypeOptions`
- `urlTransform`

Plugins are supplied as React props. GitHub-Flavored Markdown is not built in; add `remark-gfm` through `remarkPlugins` when needed:

```tsx
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

<Markdown remarkPlugins={[remarkGfm]}>{'Just a link: www.nasa.gov.'}</Markdown>
```

`components` maps rendered element names to another tag or to a component. For example, an `h1` can be rendered as `h2`, and an `em` renderer receives props including `node`:

```tsx
<Markdown
  components={{
    h1: 'h2',
    em(props) {
      const {node, ...rest} = props
      return <i style={{color: 'red'}} {...rest} />
    }
  }}
/>
```

Raw HTML requires the separate `rehype-raw` plugin and a trusted environment. Without that plugin, HTML is escaped or ignored when `skipHtml` is enabled.

## URL handling

The package exports `defaultUrlTransform(url: string): string`. Pass a custom URL transform with the `urlTransform` option when URL handling needs to differ from the default.

```ts pmcp-example
import assert from 'node:assert/strict'
import {defaultUrlTransform} from 'react-markdown'

assert.equal(typeof defaultUrlTransform, 'function')
assert.equal(typeof defaultUrlTransform('https://example.com'), 'string')
```

## Asynchronous processing

Use `MarkdownAsync` when remark or rehype processing is asynchronous. Its signature is `MarkdownAsync(options: Options): Promise<ReactElement>`.

```ts pmcp-example
import assert from 'node:assert/strict'
import React from 'react'
import {MarkdownAsync} from 'react-markdown'

const element = await MarkdownAsync({children: '# Hi'})

assert.equal(React.isValidElement(element), true)
```

The package also documents a subpath import:

```ts
import MarkdownAsync from 'react-markdown/async'

const result = await MarkdownAsync({children: '# Hi'})
```

`MarkdownAsync` supports async plugins through `async`/`await`. Components returning promises are supported on the server.

For client-side async support, use `MarkdownHooks`. It uses `useEffect` and `useState`, runs on the client, and does not immediately render processed content. Its `fallback` option is shown while processing:

```tsx
import {MarkdownHooks} from 'react-markdown'

<MarkdownHooks fallback={<p>Loading…</p>} remarkPlugins={[asyncPlugin]}>
  {markdown}
</MarkdownHooks>
```

`fallback` belongs to `HooksOptions` and `MarkdownHooks`; it is not an option for regular `Markdown`.

A direct `bun example.ts` script is not a React renderer, so it cannot exercise `MarkdownHooks`' client hook lifecycle. Render it inside a React application instead.

## v10 migration mistakes

### Do not pass `className` to `Markdown`

Version 10 removed the `className` prop. Wrap the component explicitly instead:

```tsx
<div className="markdown-body">
  <Markdown>{markdown}</Markdown>
</div>
```

This also lets the caller choose the wrapper tag and its other props.

### Do not use pre-v9 URL transform names

Older examples may use `transformImageUri` or `transformLinkUri`. Those were replaced by the single `urlTransform` option.

### Do not assume the old package/runtime shape

Older code may assume CommonJS, older Node or React minimums, or imports that do not follow the package's newer exports. Version 10 is ESM-only, targets Node.js 16+, and requires React 18+ and `@types/react` 18+.

## What this skill does not cover

- The detailed behavior of individual Markdown constructs or URL transformations.
- The API or configuration of third-party plugins such as `remark-gfm` or `rehype-raw`.
- Authoring async remark or rehype plugins.
- React DOM setup, server rendering setup, or client hook lifecycle execution.
- The exact React element tree or generated HTML after a renderer processes the returned element.

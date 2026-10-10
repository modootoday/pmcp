---
name: mdx-bundler
description: Use mdx-bundler 10.x to bundle MDX on Node, preserve frontmatter, and understand the separate React-dependent client consumption helpers.
---

Verified against mdx-bundler@10.1.1 on 2026-09-08. 2 of 2 examples executed.

# mdx-bundler

## Scope and version

This skill covers `mdx-bundler` `^10.0.0` (the 10.x line, including 10.0.0 through 10.1.1). Node 18 or newer is required. Version 10.1.0 added JSX-runtime support, and 10.1.1 fixed explicit typings.

Install the bundler and esbuild:

```sh
npm install --save mdx-bundler esbuild
```

The package uses the esbuild binary and has a dependency that requires working `node-gyp` setup.

## Server-side bundling

Import `bundleMDX` from the package root. It returns a promise resolving to `{code, frontmatter, matter}`:

- `code` is the bundled module source as a string.
- `frontmatter` is the parsed gray-matter frontmatter object.
- `matter` is the complete gray-matter result.

Use `source` for an in-memory MDX string. Use `files` for in-memory imported files. The files map can contain relative imports such as `./demo.tsx`.

```ts pmcp-example
import assert from 'node:assert/strict'
import {bundleMDX} from 'mdx-bundler'

const result = await bundleMDX({
  source: `---
title: Hello
---

# Wahoo
`,
})

assert.equal(result.frontmatter.title, 'Hello')
assert.match(result.code, /Wahoo/)
assert.equal(typeof result.matter, 'object')
```

An imported in-memory component is bundled together with the MDX source:

```ts pmcp-example
import assert from 'node:assert/strict'
import {bundleMDX} from 'mdx-bundler'

const result = await bundleMDX({
  source: `# Demo

import Demo from './demo'

<Demo />
`,
  files: {
    './demo.tsx': `
      import * as React from 'react'
      export default function Demo() {
        return <div>Neat demo!</div>
      }
    `,
  },
})

assert.equal(typeof result.code, 'string')
assert.ok(result.code.length > 0)
assert.equal(result.frontmatter && typeof result.frontmatter, 'object')
```

The documented options are `source` or `file`, `files`, `mdxOptions`, `esbuildOptions`, `globals`, `cwd`, `grayMatterOptions`, `bundleDirectory`, and `bundlePath`. `source` and `file` are alternatives: do not provide both. A `file` is read from disk and needs an appropriate `cwd` for relative imports.

## Consuming bundled code

The bundling API is the Node/server/build side. Browser or SSR consumption uses the separate client entry points:

- `mdx-bundler/client` exports `getMDXComponent` and `getMDXExport`.
- `mdx-bundler/client/jsx` exports `getMDXComponent` for the JSX-runtime setup.

The documented usage is in a React application. `getMDXComponent` creates the default component, while `getMDXExport` returns the evaluated module-shaped exports, including the default component and named exports:

```tsx
import * as React from 'react'
import {getMDXComponent} from 'mdx-bundler/client'

function Post({code}: {code: string}) {
  const Component = React.useMemo(() => getMDXComponent(code), [code])
  return <Component />
}
```

```js
import * as React from 'react'
import {getMDXExport} from 'mdx-bundler/client'

function MDXPage({code}) {
  const mdxExport = getMDXExport(code)
  console.log(mdxExport.toc)
  const Component = React.useMemo(() => mdxExport.default, [code])
  return <Component />
}
```

These client helpers are not standalone examples for the installation shown above: loading `mdx-bundler/client` reaches for React, and a direct script with only the package and esbuild installed fails when React is unavailable. Exercise these helpers in the React application or SSR environment that consumes the bundle. `getMDXComponent` evaluates bundled code with `new Function`; treat bundled code as executable code and do not use this client path for untrusted content without an appropriate security boundary.

## JSX runtime configuration

Version 10.1.x documents JSX-runtime configuration through `jsxConfig` and the `mdx-bundler/client/jsx` entry point. The documented configuration entries are `jsxLib`, `jsxDom`, and `jsxRuntime`.

Use this path when configuring the MDX bundle for the JSX runtime rather than assuming the older client helper shape is the only supported option.

## Common mistakes and version traps

- **Running on an old Node version:** v10 requires Node 18 or newer. The v9 call shape may look familiar, but v10's runtime and dependency requirements still apply.
- **Expecting `bundleMDX` in the browser:** bundling uses the esbuild binary and belongs on the Node/server/build side. Send the generated `code` to a client or SSR environment instead.
- **Providing both `source` and `file`:** these are mutually exclusive inputs. Choose the in-memory source or the disk-backed file.
- **Forgetting `cwd` for file-based relative imports:** `file` reads from disk; set `cwd` so relative imports resolve from the intended location.
- **Using `describe`, `it`, or `expect` in a direct script:** this package does not provide test-runner globals. The runnable examples use only programmatic APIs and `node:assert/strict`.
- **Assuming frontmatter dates are parsed as dates:** the v10 release notes warn that `remark-mdx-frontmatter` no longer parses dates. Account for the value exposed in `frontmatter` accordingly.
- **Assuming Cloudflare Workers can run the full package:** Workers cannot run the esbuild binary or `eval`/similar evaluation. Run bundling elsewhere or investigate a WASM-based approach.
- **Missing esbuild executable lookup in Next.js/Webpack:** those environments may need `ESBUILD_BINARY_PATH` configured before calling `bundleMDX`.
- **Copying only the old default-component recipe:** `getMDXExport` is the module-shaped alternative, and v10.1.x also documents the JSX-runtime configuration and `client/jsx` entry point. The client helpers require the React-consuming environment rather than functioning as bare standalone scripts with only the bundler installation.

## Not covered

This skill does not cover the complete shapes of every option (`mdxOptions`, `esbuildOptions`, `globals`, `grayMatterOptions`, `bundleDirectory`, or `bundlePath`), custom remark/rehype plugin configuration, detailed React rendering setup, the additional React installation/configuration needed by the client helpers, deployment-specific `ESBUILD_BINARY_PATH` values, WASM alternatives, or the internal generated-code format. The research also does not establish the exact `jsxConfig` object type beyond the documented `jsxLib`, `jsxDom`, and `jsxRuntime` entries.

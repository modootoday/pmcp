---
name: vitejs-plugin-react
description: Practical usage of @vitejs/plugin-react v6.0.0, including its Vite plugin factory, configuration options, React Compiler preset, v5-to-v6 Babel migration, and preamble requirements.
---

Verified against @vitejs/plugin-react@6.1.1 on 2026-09-07. 2 of 2 examples executed.

# @vitejs/plugin-react (^6.0.0)

## What this package is

`@vitejs/plugin-react` is a Vite/Rolldown plugin for React. Its default export creates Vite plugins; it is not a standalone JSX transformer or test runner.

Version 6.0.0 requires:

- Vite 8 or newer
- Node `^20.19.0 || >=22.12.0`

The package metadata marks raw Rollup as incompatible because the plugin uses Vite/Rolldown-specific APIs. Configure it through Vite rather than trying to run it as a generic Rollup plugin.

## Normal configuration

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
```

The default export is:

```ts
function viteReact(opts?: Options): Plugin[]
```

The default behavior is:

- `include`: `/\.[tj]sx?$/`
- `exclude`: `/\/node_modules\//`
- `jsxImportSource`: `'react'`
- JSX runtime: automatic

Available options:

```ts
interface Options {
  include?: string | RegExp | Array<string | RegExp>
  exclude?: string | RegExp | Array<string | RegExp>
  jsxImportSource?: string
  jsxRuntime?: 'classic' | 'automatic'
  reactRefreshHost?: string
}
```

For example, include MDX files explicitly:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react({ include: /\.(mdx|js|jsx|ts|tsx)$/ }),
  ],
})
```

Use `jsxRuntime: 'classic'` only when the project needs the classic JSX runtime. Otherwise, the automatic runtime is the default.

### Standalone API shape check

The package is normally exercised by Vite. This direct script checks the part that can be reached without a Vite config or runner: creating the plugin array.

```ts pmcp-example
import assert from 'node:assert/strict'
import react from '@vitejs/plugin-react'

const plugins = react({
  include: /\.(tsx|jsx)$/,
  exclude: /\/node_modules\//,
  jsxImportSource: 'react',
  jsxRuntime: 'automatic',
})

assert.equal(Array.isArray(plugins), true)
assert.equal(plugins.length > 0, true)
```

## Babel configuration changed in v6

Do not use the v5 configuration shape:

```ts
react({
  babel: {
    presets: [...],
    plugins: [...],
    babelrc: true,
    configFile: true,
  },
})
```

In v6, Babel is no longer a plugin dependency, and the `babel` option and related features were removed. Configure Babel with `@rolldown/plugin-babel` as a separate Vite plugin:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

export default defineConfig({
  plugins: [
    react(),
    babel({
      plugins: ['@babel/plugin-proposal-throw-expressions'],
    }),
  ],
})
```

The important migration is that `react()` and `babel(...)` are separate entries in the `plugins` array.

## React Compiler

The package exports the named helper `reactCompilerPreset`. It is not a standalone compiler setup. Install the required peer dependencies:

```sh
npm install -D @rolldown/plugin-babel babel-plugin-react-compiler
```

Then configure both plugins:

```ts
import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

export default defineConfig({
  plugins: [
    react(),
    babel({
      presets: [reactCompilerPreset()],
    }),
  ],
})
```

Supported preset options are:

- `compilationMode: 'annotation'`
- `target: '17' | '18'`

For example:

```ts
babel({
  presets: [
    reactCompilerPreset({
      compilationMode: 'annotation',
      target: '18',
    }),
  ],
})
```

The helper's shape is:

```ts
reactCompilerPreset(options?): RolldownBabelPreset
```

A plain script can reach the named export, although actual compiler transformation requires the Vite/Rolldown Babel integration and its peer dependencies:

```ts pmcp-example
import assert from 'node:assert/strict'
import { reactCompilerPreset } from '@vitejs/plugin-react'

assert.equal(typeof reactCompilerPreset, 'function')
```

## Fast Refresh and the preamble

The plugin supports Fast Refresh. For SSR HMR, initialization must happen through Vite's `transformIndexHtml` or through the package's preamble entry:

```ts
import '@vitejs/plugin-react/preamble'
```

The package export `./preamble` points to `./types/preamble.d.ts`, so this entry is types-only at package level. It is not a standalone runtime helper to execute in a direct Bun script.

Without the equivalent initialization, the documented failure is:

```text
Uncaught Error: @vitejs/plugin-react can't detect preamble. Something is wrong.
```

## Common mistakes

- Using `react({ babel: ... })` copied from `@vitejs/plugin-react` v5. Move Babel configuration to `@rolldown/plugin-babel`.
- Installing or configuring this as a raw Rollup plugin. v6 is coupled to Vite/Rolldown APIs.
- Assuming `reactCompilerPreset()` replaces `@rolldown/plugin-babel` and `babel-plugin-react-compiler`. It does not; configure both plugins and install the peer dependencies.
- Forgetting that v6 requires Vite 8+. Vite 7 and earlier are unsupported.
- Treating `@vitejs/plugin-react/preamble` as a normal runtime utility. The package export is types-only; use the documented Vite/SSR integration context.
- Expecting a direct script to transform JSX. The package's normal transformation and Fast Refresh behavior are exercised by Vite.

## Does not cover

This skill does not cover Vite application setup, Vite's full plugin-hook lifecycle, SSR implementation, `transformIndexHtml` configuration, Rolldown Babel plugin options beyond the shown integration, Babel plugin authoring, React Compiler behavior itself, or JSX transformation outside Vite. Those require the corresponding tools and configuration rather than this package alone.

Sources:

- https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/package.json?utm_source=openai
- https://github.com/vitejs/vite-plugin-react/blob/plugin-react%406.0.0/packages/plugin-react/src/index.ts?plain=1
- https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md?plain=1&utm_source=openai
- https://github.com/vitejs/vite-plugin-react/blob/plugin-react%406.0.0/packages/plugin-react/src/reactCompilerPreset.ts?plain=1
- https://raw.githubusercontent.com/vitejs/vite-plugin-react/plugin-react%406.0.0/packages/plugin-react/CHANGELOG.md
- https://raw.githubusercontent.com/vitejs/vite-plugin-react/plugin-react%405.1.4/packages/plugin-react/README.md
- https://raw.githubusercontent.com/vitejs/vite-plugin-react/plugin-react%406.0.0/packages/plugin-react/README.md
- https://raw.githubusercontent.com/vitejs/vite-plugin-react/plugin-react%406.0.0/packages/plugin-react/package.json

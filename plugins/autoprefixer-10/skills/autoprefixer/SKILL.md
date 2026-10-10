---
name: autoprefixer
description: Use Autoprefixer ^10.0.0 as a PostCSS 8 plugin from a plain Node/Bun script, including its callable API, plugin inspection, options, and the v10 peer-dependency shape.
---

Verified against autoprefixer@10.5.5 on 2026-09-07. 2 of 2 examples executed.

# autoprefixer ^10.0.0

Autoprefixer is a PostCSS plugin. In v10 it uses PostCSS 8, and `postcss` is a peer dependency, so install both packages:

```sh
npm install --save-dev autoprefixer postcss
```

## Import and construct the plugin

The package has a CommonJS callable export:

```js
const autoprefixer = require('autoprefixer')
```

It accepts either an options object, a browser list plus options, or options supplied through the normal Browserslist project configuration. The documented options include:

- `env`
- `cascade`
- `add`
- `remove`
- `supports`
- `flexbox`
- `grid`
- `stats`
- `overrideBrowserslist`
- `ignoreUnknownVersions`

For example:

```js
const plugin = autoprefixer({ cascade: false })
```

`autoprefixer(options)` returns a new PostCSS plugin. The returned plugin also exposes `info()`.

## Process CSS programmatically

Use PostCSS directly in a plain script. Do not use `describe`, `it`, or `expect`; those are runner globals and are not provided by Autoprefixer.

```ts pmcp-example
const assert = require('node:assert/strict')
const autoprefixer = require('autoprefixer')
const postcss = require('postcss')

const result = await postcss([autoprefixer()]).process(
  '.card { display: flex }',
  { from: undefined }
)

assert.equal(typeof result.css, 'string')
assert.match(result.css, /display:\s*flex/)
assert.ok(Array.isArray(result.warnings()))
```

PostCSS can process several CSS files for performance. Inspect warnings with `result.warnings()` and convert individual warnings with `warn.toString()` when reporting them.

The documented equivalent shape is:

```js
postcss([autoprefixer])
  .process(css)
  .then(result => {
    result.warnings().forEach(warn => {
      console.warn(warn.toString())
    })
    console.log(result.css)
  })
```

Calling `autoprefixer()` is useful when passing options; passing the callable export itself is also the documented PostCSS usage.

## Grid translation

Grid translation is disabled by default. Enable it explicitly with:

```js
autoprefixer({ grid: 'autoplace' })
```

It can also be enabled by the CSS control comment:

```css
/* autoprefixer grid: autoplace */
```

The documented environment-variable form is `AUTOPREFIXER_GRID=autoplace`, but that form belongs to a surrounding build command or runner.

## Inspect the plugin and package API

The imported callable exposes these properties and methods:

- `autoprefixer.defaults`: the default browser list
- `autoprefixer.data`: Autoprefixer data
- `autoprefixer.info(options?)`: information for the default Autoprefixer configuration; it accepts an optional `{ from?: string }`
- `autoprefixer.postcss`: `true`

The plugin returned by `autoprefixer(...)` also exposes `info()`.

```ts pmcp-example
const assert = require('node:assert/strict')
const autoprefixer = require('autoprefixer')

assert.equal(autoprefixer.postcss, true)
assert.ok(autoprefixer.defaults)
assert.ok(autoprefixer.data)
assert.equal(typeof autoprefixer.info(), 'string')
assert.equal(typeof autoprefixer.info({ from: 'styles.css' }), 'string')

const plugin = autoprefixer({ grid: 'autoplace' })
assert.equal(typeof plugin.info, 'function')
assert.equal(typeof plugin.info(), 'string')
```

## Browser targets

Browser targets normally come from a `.browserslistrc` file or the `browserslist` key in `package.json`. This is preferred when the same targets should be shared by tools such as Babel, ESLint, and Stylelint.

The API also supports browser lists and the `overrideBrowserslist` option, but the target configuration is project/build configuration rather than a standalone CSS runtime feature.

## Common mistakes

- **Using the v9 dependency shape.** Autoprefixer v10 moved to PostCSS 8 and moved `postcss` to `peerDependencies`. Install `postcss` alongside Autoprefixer.
- **Expecting the package to be a complete CSS runner.** Autoprefixer returns a PostCSS plugin; use `postcss(...).process(...)` in a plain script.
- **Putting runner examples directly in a script.** `describe`, `it`, and `expect` are not available when Bun runs an example directly.
- **Expecting grid prefixes by default.** Grid translation is disabled unless enabled with `grid: 'autoplace'`, a CSS control comment, or the documented build-environment variable.
- **Expecting polyfills.** Autoprefixer only adds prefixes; it does not provide client-side polyfills.
- **Expecting legacy prefixed input to be expanded.** Autoprefixer needs the unprefixed property in order to add prefixes.
- **Assuming CLI, Webpack, or Gulp integration is part of this package's standalone API.** Those integrations require their surrounding tools: `postcss-cli`, `postcss-loader`, or `gulp-postcss` respectively.

## Not covered

This skill does not cover the exact prefixes produced for particular browser queries, the full contents of Autoprefixer's data or default browser list, detailed option semantics, Browserslist configuration syntax, PostCSS plugin authoring, CLI configuration, Webpack configuration, Gulp configuration, or the standalone browser/non-Node build.

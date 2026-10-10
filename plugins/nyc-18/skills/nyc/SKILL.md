---
name: nyc
description: Use nyc 18.x for its CommonJS API, coverage-file lifecycle, directory resolution, and CLI/runner boundaries. Covers the Node runtime change from nyc 17.x and avoids standalone examples that depend on runner or subprocess internals.
---

Verified against nyc@18.0.0 on 2026-09-08. 3 of 3 examples executed.

# nyc 18.x

## Runtime and package shape

`nyc` 18.0.0 exposes one CommonJS export: the `NYC` class.

```js
const NYC = require('nyc')
const nyc = new NYC({ cwd: process.cwd() })
```

The supported Node engine is `20 || >=22`. This is the important migration difference from nyc 17.x: nyc 17 had already raised its minimum Node version to 18, while nyc 18's transitive dependencies require Node 20 or Node 22 and newer. Do not assume a Node 18 runtime is sufficient.

The constructor copies the supplied configuration. Relevant fields are:

- `cwd`: base directory; defaults to `process.cwd()`.
- `tempDirectory` or the older alias `tempDir`: temporary coverage directory; defaults to `./.nyc_output`.
- `reportDir`: report directory; defaults to `coverage`.
- `reporter`: one reporter or an array; defaults to `text`.

`tempDirectory()` and `reportDirectory()` return absolute paths resolved from `cwd`.

```ts pmcp-example
const assert = require('node:assert/strict')
const NYC = require('nyc')
const path = require('node:path')

const nyc = new NYC({
  cwd: '/workspace/project',
  tempDirectory: '.coverage-data',
  reportDir: 'artifacts/coverage',
  reporter: ['text', 'lcov']
})

assert.equal(nyc.cwd, '/workspace/project')
assert.deepEqual(nyc.reporter, ['text', 'lcov'])
assert.equal(nyc.tempDirectory(), path.resolve('/workspace/project', '.coverage-data'))
assert.equal(nyc.reportDirectory(), path.resolve('/workspace/project', 'artifacts/coverage'))
```

When using older configuration, `tempDir` is still accepted. Prefer `tempDirectory` in new code, but do not replace it with an unrelated field name.

```ts pmcp-example
const assert = require('node:assert/strict')
const NYC = require('nyc')
const path = require('node:path')

const nyc = new NYC({ cwd: '/repo', tempDir: 'tmp/nyc' })

assert.equal(nyc.tempDirectory(), path.resolve('/repo', 'tmp/nyc'))
assert.equal(nyc.reportDirectory(), path.resolve('/repo', 'coverage'))
assert.deepEqual(nyc.reporter, ['text'])
```

## Instrumentation

The programmatic instrumentation methods exposed by the class are:

- `instrumenter()`
- `addFile(filename)`: reads and instruments a named file.
- `wrap(bin)`: wraps a command or executable and returns the same `NYC` instance.

`instrumenter()` is a plain API call, but `wrap()` reaches into subprocess/runtime internals. It is not suitable for a standalone `bun example.ts` example: in this execution environment it requires an internal Node binding that Bun does not implement. Exercise wrapping through nyc's supported command-line/tool execution instead.

`addFile()` performs file I/O and instrumentation. Supply an actual source filename when invoking it in a real application; a nonexistent filename is not a valid no-op.

## Coverage files

`writeCoverageFile()` writes coverage data. `coverageFiles(baseDirectory)` asynchronously reads the directory and returns the result of `fs.readdir`; when no directory is supplied it uses `tempDirectory()`.

`coverageFileLoad(filename, baseDirectory)` asynchronously parses the named JSON coverage file. Its default base directory is `tempDirectory()`. If loading or parsing fails, it returns `{}` rather than throwing for that failure.

```ts pmcp-example
const assert = require('node:assert/strict')
const NYC = require('nyc')

;(async () => {
  const nyc = new NYC({ cwd: process.cwd() })
  const loaded = await nyc.coverageFileLoad('missing-coverage-file.json', process.cwd())

  assert.deepEqual(loaded, {})
})()
```

Use `coverageFiles()` only after the temporary coverage directory exists. Use `writeCoverageFile()` after instrumentation has produced coverage data; these methods are filesystem operations, not in-memory configuration helpers.

## Temporary directories, reset, and reports

The lifecycle methods are:

- `createTempDirectory()`: asynchronously creates the temporary coverage directory.
- `reset()`: resets nyc's coverage state.
- `report()`: creates reports using the configured reporters.
- `getCoverageMapFromAllCoverageFiles(baseDirectory)`: asynchronously combines coverage files; the base directory is the coverage temporary directory when omitted.

`report()` creates reports using the configured reporters. Ensure that coverage data and the temporary directory are available before calling it.

## CLI and runner boundary

nyc is the Istanbul command-line client. In CLI usage, nyc options must appear before the program it executes:

```json
{
  "scripts": {
    "test": "mocha",
    "coverage": "nyc npm run test"
  }
}
```

A direct CLI form is:

```sh
nyc --reporter=lcov --reporter=text-summary ava
```

The command being measured follows nyc's options. nyc wraps test runners or npm scripts; it is not a replacement for the runner.

Do not put `describe`, `it`, or `expect` in a standalone `bun example.ts` example. Those names are normally supplied by a test runner and are not provided by nyc.

`jest` and `tap` already include IstanbulJS libraries. For those runners, use their coverage configuration rather than installing nyc unnecessarily.

## Configuration loading

Loading nyc configuration is provided separately by `@istanbuljs/load-nyc-config`, not by the documented nyc CLI surface. Its `loadNycConfig()` API is asynchronous and does not consider command-line arguments:

```js
const {loadNycConfig} = require('@istanbuljs/load-nyc-config')
;(async () => {
  console.log(await loadNycConfig())
})()
```

Do not treat this utility as if it resolved nyc CLI flags.

## What this skill does not cover

- The complete nyc CLI option list or command-line parsing behavior.
- Test-runner-specific setup for Mocha, Ava, Jest, Tap, or other runners.
- Using `wrap()` in a standalone Bun script; its subprocess internals require the tool/runtime execution path.
- The exact shape of instrumented source and coverage-map objects.
- Reporter-specific output formats or reporter configuration beyond selecting reporter names.
- The contents of nyc configuration files.
- Source-map, exclude/include, subprocess, or caching behavior not shown by the supplied research.
- How to implement a complete filesystem-backed coverage lifecycle in an application.

---
name: mocha
description: Use Mocha ^12.0.0 programmatically, with the ESM package shape and runner-loading rules rather than v11-era assumptions.
---

Verified against mocha@12.0.0 on 2026-09-08. 2 of 2 examples executed.

# Mocha 12

## Version and module shape

Mocha 12 requires Node `^20.19.0 || >=22.12.0`. The package is ESM and its entry points are ESM. In CommonJS, use the `Mocha` property:

```js
const { Mocha } = require('mocha');
```

Do not assume that `require('mocha')` itself is the constructor. In an ESM script, the documented programmatic form is:

```js
import Mocha from 'mocha';
```

The documented class has static members including `Mocha.reporters` and `Mocha.Runner`. The documented `Mocha.version` member is readonly, but do not use its presence as a standalone capability check: it is not available on the imported value in every supported import shape.

## Construct and configure a runner

Create a runner with options, or configure it through chainable methods. The documented surface includes:

- `new Mocha(options)`
- `ui(uiName)`
- `timeout(milliseconds)`
- `retries(count)`
- `grep(regexp)`
- `invert()`
- `reporter(name, options)`

Timeouts can be supplied as milliseconds or duration strings such as `1s`. Reporter options are passed as the second argument to `reporter()`.

```ts pmcp-example
import Mocha from "mocha";
import assert from "node:assert/strict";

const mocha = new Mocha({ timeout: 1000, reporter: "spec" });

assert.equal(mocha.ui("bdd"), mocha);
assert.equal(mocha.timeout("1s"), mocha);
assert.equal(mocha.retries(1), mocha);
assert.equal(mocha.grep(/match/i), mocha);
assert.equal(mocha.invert(), mocha);
assert.equal(mocha.reporter("spec"), mocha);
assert.equal(typeof Mocha.Runner, "function");
assert.equal(typeof Mocha.reporters, "object");
```

## Loading test files and running

Use `addFile(file)` to add test files, then call `loadFilesAsync()`. This API supports both CommonJS and ESM test files. Its optional `esmDecorator` function runs before an ESM module is imported.

After loading, call `mocha.run(callback)`. A command-line-style program should set its exit code from the failure count and handle loading failures:

```js
mocha.loadFilesAsync()
  .then(() => mocha.run(failures => {
    process.exitCode = failures ? 1 : 0;
  }))
  .catch(() => {
    process.exitCode = 1;
  });
```

`mocha.run()` loads files through Node `require`. Loaded files remain in `require.cache`; reruns may therefore require clearing the relevant cache entries or creating a new `Mocha` instance.

A standalone script can exercise the runner without a test file, but runner state is only meaningful once tests have been loaded:

```ts pmcp-example
import Mocha from "mocha";
import assert from "node:assert/strict";

const mocha = new Mocha({ reporter: "dot" });

await new Promise((resolve, reject) => {
  try {
    mocha.run(failures => {
      try {
        assert.equal(failures, 0);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  } catch (error) {
    reject(error);
  }
});
```

For actual tests, call `addFile()` with test-file paths and call `loadFilesAsync()` before `run()`. Test execution, test-file discovery, and runner state are not demonstrated by the standalone example because they require test files and the runner itself.

## CLI and configuration

Normal execution is through the Mocha CLI:

```sh
npx mocha --help
mocha [spec...]
```

The defaults include:

- spec: `test`
- extensions: `js,cjs,mjs`
- reporter: `spec`
- timeout: `2000`

Configuration discovery, merging, `MOCHA_OPTIONS`, `--config`, `--package`, watch mode, reporters, interfaces, and test-file globbing are CLI/runner behavior rather than behavior of an arbitrary standalone JavaScript file.

Mocha 12 uses this ESM configuration shape in `.mocharc.mjs`:

```js
export default {
  timeout: 1000
};
```

A `.mocharc.js` file can use the same shape when the package is configured as ESM with `"type": "module"`.

In Mocha 12, `--forbid-only` defaults to `true` when `CI` is set and otherwise defaults to `false`. Mocha 12 also adds `--fail-hook-affected-tests`; tests affected by a failing hook are reported as failures.

## ESM and runner limitations

Native ESM support does not make every runner feature ESM-compatible:

- Watch mode does not support ESM test files.
- Custom reporters and interfaces are loaded with `require` and cannot use top-level `await`.

The browser ESM entry is separate from the Node package API:

```html
<script type="module">
  import * as mocha from "./node_modules/mocha/mocha.js";

  mocha.setup("bdd");
  await import("./unit-test.js");
  mocha.run();
</script>
```

## Mocha 12 CLI changes

Mocha 12 moved CLI parsing from `yargs`, `yargs-parser`, and `yargs-unparser` to Node's `util.parseArgs`. Check automation that depends on older parsing edge cases, particularly negative numbers or quoted strings.

The `bin/_mocha` entry was removed. Use the supported `mocha` command or the documented programmatic API.

## Not covered

This skill does not cover the complete CLI option list, reporter output formats, interface-specific test syntax, configuration merge precedence in individual cases, watch-mode operation, browser bundling details, custom reporter or interface implementation, or filesystem-backed test fixtures. Those areas require the Mocha CLI, a project configuration, or test files and are not demonstrated by the standalone examples here.

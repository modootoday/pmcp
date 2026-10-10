---
name: cliui
description: Use cliui ^9.0.0 to build terminal UI strings with rows, columns, wrapping, padding, alignment, borders, and the single-string layout DSL.
---

Verified against cliui@9.0.1 on 2026-09-08. 7 of 7 examples executed.

# cliui

## Version and module format

`^9.0.0` resolves to `9.0.1`. The package is published as ESM and its package metadata requires Node `>=20`. Use the documented default import:

```ts pmcp-example
import assert from "node:assert/strict";
import cliui from "cliui";

const ui = cliui({});
ui.div("Usage: $0 [command] [options]");

assert.equal(typeof ui.toString(), "string");
assert.match(ui.toString(), /Usage: \$0/);
```

Do not copy the commonly seen v8 shape:

```js
const ui = require('cliui')()
```

Version 9 moved to ESM. Version `9.0.1` fixed `require("cliui")` for CommonJS, but the package remains published with ESM metadata and the documented v9 usage is `import cliui from "cliui"`.

## Create and configure a UI

Pass an options object to the factory. The documented options include `width` and `wrap`.

```ts pmcp-example
import assert from "node:assert/strict";
import cliui from "cliui";

const ui = cliui({ width: 30, wrap: true });
ui.div("A line in a configured UI");

assert.equal(typeof ui.toString(), "string");
assert.match(ui.toString(), /A line in a configured UI/);
```

## Rows and columns with `div`

`ui.div(...)` creates a row. Arguments can be strings or column objects. Column objects support `text`, `width`, `align`, `padding`, and `border`.

```ts pmcp-example
import assert from "node:assert/strict";
import cliui from "cliui";

const ui = cliui({});
ui.div(
  {
    text: "-f, --file",
    width: 20,
    padding: [0, 4, 0, 4]
  },
  {
    text: "the file to load.",
    width: 20
  },
  {
    text: "[required]",
    align: "right"
  }
);

const output = ui.toString();
assert.match(output, /-f, --file/);
assert.match(output, /the file to load\./);
assert.match(output, /\[required\]/);
```

A string argument is also valid as a column or complete row:

```ts pmcp-example
import assert from "node:assert/strict";
import cliui from "cliui";

const ui = cliui({});
ui.div("first column", "second column");

const output = ui.toString();
assert.match(output, /first column/);
assert.match(output, /second column/);
```

## Single-string layout DSL

When a single string is passed to `ui.div`, the string has layout markers:

- `\n` creates a new row.
- `\t` creates a new column.
- `\s` creates padding.

```ts pmcp-example
import assert from "node:assert/strict";
import cliui from "cliui";

const ui = cliui({ width: 60 });
ui.div(
  "Usage: node ./bin/foo.js\n" +
  "  <regex>\t  provide a regex\n" +
  "  <glob>\t  provide a glob\t [required]"
);

const output = ui.toString();
assert.match(output, /Usage: node \.\/bin\/foo\.js/);
assert.match(output, /<regex>/);
assert.match(output, /provide a regex/);
assert.match(output, /<glob>/);
assert.match(output, /\[required\]/);
```

## Append with `span`

`ui.span(...)` appends the next row without creating a new line. It accepts the same string and column forms documented for layout rows.

```ts pmcp-example
import assert from "node:assert/strict";
import cliui from "cliui";

const ui = cliui({});
ui.div("left");
ui.span("right");

const output = ui.toString();
assert.match(output, /left/);
assert.match(output, /right/);
assert.ok(output.indexOf("left") < output.indexOf("right"));
```

## Reset accumulated output

`ui.resetOutput()` resets the UI elements while maintaining the configured `width` and `wrap` settings.

```ts pmcp-example
import assert from "node:assert/strict";
import cliui from "cliui";

const ui = cliui({ width: 40, wrap: true });
ui.div("content before reset");
assert.match(ui.toString(), /content before reset/);

ui.resetOutput();
assert.equal(ui.toString(), "");

ui.div("content after reset");
assert.match(ui.toString(), /content after reset/);
```

## What this skill does not cover

- Exact rendering rules for every combination of width, wrapping, alignment, padding, and borders.
- The complete set of accepted values or semantics for each column option.
- Package internals, TypeScript compilation, or repository development scripts.
- CLI invocation: the research documents cliui as a programmatic UI-string builder, not as a package-owned command-line runner.
- Runtime behavior outside the documented Node `>=20` environment.

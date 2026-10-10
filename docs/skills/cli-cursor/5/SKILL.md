---
name: cli-cursor
description: Use cli-cursor v5.0.0 to show, hide, or conditionally toggle a terminal cursor from ESM code.
---

Verified against cli-cursor@5.0.0 on 2026-09-08. 3 of 3 examples executed.

# cli-cursor

## Import and compatibility

`cli-cursor` v5.0.0 is an ESM-only package with one default export:

```ts
import cliCursor from 'cli-cursor';
```

It requires Node.js 18 or newer. The v5 package metadata explicitly exposes its bundled TypeScript declarations. Do not use a CommonJS `require()` or look for named exports; the API is the default `cliCursor` object. ([package metadata](https://raw.githubusercontent.com/sindresorhus/cli-cursor/v5.0.0/package.json), [type declarations](https://raw.githubusercontent.com/sindresorhus/cli-cursor/v5.0.0/index.d.ts))

## API

```ts
show(stream?: NodeJS.WritableStream): void;
hide(stream?: NodeJS.WritableStream): void;
toggle(force?: boolean, stream?: NodeJS.WritableStream): void;
```

The optional stream defaults to `process.stderr`. `force` comes before `stream`, so pass the boolean first when using `toggle` with a custom stream.

The methods only write when the selected stream has `isTTY` set. On a TTY, `show()` writes the cursor-show escape sequence (`\u001B[?25h`), and `hide()` writes the cursor-hide escape sequence (`\u001B[?25l`). Hiding also invokes cursor restoration behavior. The package describes the cursor as being gracefully restored when the process exits. ([type declarations](https://raw.githubusercontent.com/sindresorhus/cli-cursor/v5.0.0/index.d.ts), [implementation](https://raw.githubusercontent.com/sindresorhus/cli-cursor/v5.0.0/index.js), [package page](https://www.npmjs.com/package/cli-cursor?activeTab=code&utm_source=openai))

### Show and hide with a stream

A non-TTY stream is intentionally ignored. Supplying a TTY-like writable is useful for testing or when the output stream is not `process.stderr`.

```ts pmcp-example
import assert from 'node:assert/strict';
import cliCursor from 'cli-cursor';

let output = '';
const stream = {
  isTTY: true,
  write(chunk: string) {
    output += chunk;
    return true;
  },
};

cliCursor.show(stream);
assert.equal(output, '\u001B[?25h');

output = '';
cliCursor.hide(stream);
assert.equal(output, '\u001B[?25l');
```

### Conditional toggle

`toggle(true, stream)` shows the cursor and `toggle(false, stream)` hides it. The boolean is not a stream option; it is the first argument.

```ts pmcp-example
import assert from 'node:assert/strict';
import cliCursor from 'cli-cursor';

let output = '';
const stream = {
  isTTY: true,
  write(chunk: string) {
    output += chunk;
    return true;
  },
};

cliCursor.toggle(true, stream);
assert.equal(output, '\u001B[?25h');

output = '';
cliCursor.toggle(false, stream);
assert.equal(output, '\u001B[?25l');
```

### Non-TTY behavior

The methods return without writing when `stream.isTTY` is false. This matters when a CLI is piped or its output is captured.

```ts pmcp-example
import assert from 'node:assert/strict';
import cliCursor from 'cli-cursor';

let output = '';
const stream = {
  isTTY: false,
  write(chunk: string) {
    output += chunk;
    return true;
  },
};

cliCursor.show(stream);
cliCursor.hide(stream);
cliCursor.toggle(true, stream);
cliCursor.toggle(false, stream);

assert.equal(output, '');
```

## Common mistakes

- **Using the older-looking export shape:** import the default export as `cliCursor`; v5 does not document named `show`, `hide`, or `toggle` exports.
- **Using CommonJS:** v5 declares `type: "module"`; use ESM import syntax.
- **Expecting output from a captured or piped stream:** cursor control is skipped when `isTTY` is falsy.
- **Putting the stream first in `toggle`:** its signature is `toggle(force?, stream?)`, not `toggle(stream, force)`.
- **Assuming the API changed from v4:** the method API is unchanged, but v5 requires Node.js 18 or newer and uses `restore-cursor` v5. ([v5 package metadata](https://raw.githubusercontent.com/sindresorhus/cli-cursor/v5.0.0/package.json), [repository README](https://github.com/sindresorhus/cli-cursor))

## Not covered

This skill does not cover the internal `restore-cursor` package API, terminal-specific behavior beyond the documented `isTTY` check and escape sequences, or integrating cursor control into a particular CLI framework. The package has no documented command-line runner; use its imported programmatic API directly.

---
name: ansi-escapes
description: Use ansi-escapes 7.x from ESM code to generate terminal escape-code strings for cursor movement, screen and line control, hyperlinks, images, and iTerm2 features.
---

Verified against ansi-escapes@7.3.0 on 2026-09-08. 5 of 5 examples executed.

# ansi-escapes 7.x

## Runtime and module shape

`ansi-escapes@^7.0.0` is ESM-only in practice. Use Node.js 18 or newer and import it with `import`, not `require()`. The package has no CLI or runtime runner: its APIs return strings, which the caller writes to a terminal or terminal emulator.

Both import styles are supported:

```ts pmcp-example
import assert from 'node:assert/strict';
import ansiEscapes, {cursorUp, cursorLeft} from 'ansi-escapes';

assert.equal(ansiEscapes.cursorUp(2), '\u001B[2A');
assert.equal(cursorUp(2) + cursorLeft, '\u001B[2A\u001B[G');
assert.equal(ansiEscapes.cursorLeft, cursorLeft);
```

The older major's default-object usage remains valid, but version 7 also exports the declarations as named exports. Do not assume the 6.x package metadata: version 7 requires Node `>=18`, is ESM-only, and exposes `./index.js` together with its declarations.

## Cursor movement and position

Available cursor APIs are:

- `cursorTo(x, y?)`
- `cursorMove(x, y?)`
- `cursorUp(count)`
- `cursorDown(count)`
- `cursorForward(count)`
- `cursorBackward(count)`

Cursor constants are `cursorLeft`, `cursorSavePosition`, `cursorRestorePosition`, `cursorGetPosition`, `cursorNextLine`, `cursorPrevLine`, `cursorHide`, and `cursorShow`.

All of these produce strings. Combine them and write the result yourself; the package does not move the cursor directly. `cursorMove(x, y?)` emits the horizontal movement before the vertical movement when both components are present.

```ts pmcp-example
import assert from 'node:assert/strict';
import {
  cursorTo,
  cursorMove,
  cursorUp,
  cursorDown,
  cursorForward,
  cursorBackward,
  cursorLeft,
  cursorSavePosition,
  cursorRestorePosition,
  cursorGetPosition,
  cursorNextLine,
  cursorPrevLine,
  cursorHide,
  cursorShow,
} from 'ansi-escapes';

assert.equal(cursorTo(4), '\u001B[5G');
assert.equal(cursorTo(4, 2), '\u001B[3;5H');
assert.equal(cursorMove(2, -3), '\u001B[2C\u001B[3A');
assert.equal(cursorUp(2), '\u001B[2A');
assert.equal(cursorDown(2), '\u001B[2B');
assert.equal(cursorForward(2), '\u001B[2C');
assert.equal(cursorBackward(2), '\u001B[2D');

for (const value of [
  cursorLeft,
  cursorSavePosition,
  cursorRestorePosition,
  cursorGetPosition,
  cursorNextLine,
  cursorPrevLine,
  cursorHide,
  cursorShow,
]) {
  assert.equal(typeof value, 'string');
}
```

Do not copy the older example that expects `cursorLeft` to be `\u001B[1000D`; version 7 produces a cursor-left escape represented as `\u001B[G`.

## Erasing, scrolling, and screen control

The line and screen exports are:

- `eraseLines(count)`
- `eraseEndLine`, `eraseStartLine`, `eraseLine`
- `eraseDown`, `eraseUp`, `eraseScreen`
- `scrollUp`, `scrollDown`
- `clearScreen`, `clearTerminal`
- `enterAlternativeScreen`, `exitAlternativeScreen`
- `beep`

Use `eraseLines(count)` when the number of lines is dynamic. The other names are string constants.

```ts pmcp-example
import assert from 'node:assert/strict';
import ansiEscapes, {
  eraseLines,
  eraseEndLine,
  eraseStartLine,
  eraseLine,
  eraseDown,
  eraseUp,
  eraseScreen,
  scrollUp,
  scrollDown,
  clearScreen,
  clearTerminal,
  enterAlternativeScreen,
  exitAlternativeScreen,
  beep,
} from 'ansi-escapes';

assert.equal(typeof eraseLines(3), 'string');
for (const value of [
  eraseEndLine,
  eraseStartLine,
  eraseLine,
  eraseDown,
  eraseUp,
  eraseScreen,
  scrollUp,
  scrollDown,
  clearScreen,
  clearTerminal,
  enterAlternativeScreen,
  exitAlternativeScreen,
  beep,
]) {
  assert.equal(typeof value, 'string');
}

assert.equal(typeof ansiEscapes.clearTerminal, 'string');
```

## Hyperlinks, images, and iTerm2 features

`link(text, url)` returns a terminal hyperlink escape sequence. Terminal support is provided by the terminal emulator, not by this package.

`image(data, options?)` returns an image escape sequence. The input is a `Uint8Array`; in Node, a `Buffer` is also a `Uint8Array`. Image options are optional, and `preserveAspectRatio` defaults to `true`.

The `iTerm` namespace provides `iTerm.setCwd(path?)` and `iTerm.annotation(message, options?)`. These sequences are intended for iTerm2; generating them does not make another terminal support them.

```ts pmcp-example
import assert from 'node:assert/strict';
import ansiEscapes, {link, image, iTerm} from 'ansi-escapes';

const hyperlink = link('Click here', 'https://example.com');
assert.equal(typeof hyperlink, 'string');
assert.ok(hyperlink.includes('Click here'));
assert.ok(hyperlink.includes('https://example.com'));

const imageSequence = image(new Uint8Array([0, 1, 2, 3]));
assert.equal(typeof imageSequence, 'string');
assert.ok(imageSequence.length > 0);

const cwdSequence = iTerm.setCwd('/tmp');
assert.equal(typeof cwdSequence, 'string');
assert.ok(cwdSequence.length > 0);

const annotationSequence = iTerm.annotation('build complete');
assert.equal(typeof annotationSequence, 'string');
assert.ok(annotationSequence.length > 0);

assert.equal(typeof ansiEscapes.link, 'function');
```

## Writing the result

The package only creates escape-code strings. Write them to an output stream or pass them to a terminal implementation:

```ts pmcp-example
import assert from 'node:assert/strict';
import ansiEscapes from 'ansi-escapes';

let output = '';
output += ansiEscapes.cursorUp(2) + ansiEscapes.cursorLeft;
assert.equal(output, '\u001B[2A\u001B[G');
```

Do not expect importing the package to alter the terminal, and do not wrap examples in `describe`, `it`, or `expect`; those are runner globals and are not available in a directly executed script.

## Not covered

This skill does not cover terminal-by-terminal compatibility, the complete option shapes for image or iTerm annotations, the exact escape encoding of every export, browser integration, or how to read image data from a filesystem. It also does not cover a CLI or runner because ansi-escapes exposes no documented CLI or runtime runner.

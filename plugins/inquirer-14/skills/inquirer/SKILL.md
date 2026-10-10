---
name: inquirer
description: Use Inquirer.js 14's legacy prompt API correctly, including v14 prompt registration behavior, prompt-module creation, separators, and interactive-terminal limitations.
---

Verified against inquirer@14.2.2 on 2026-09-08. 3 of 3 examples executed.

# inquirer (`^14.0.0`)

## Scope and package shape

This package is the legacy/maintenance Inquirer.js API. The newer prompt API is provided by `@inquirer/prompts`; both packages may be used together during migration.

The version range resolves within major 14. The versioned documentation and source checked here are for `inquirer@14.0.2`.

The default export is the `inquirer` object. Its documented surface includes:

- `prompt(questions, answers)`
- `createPromptModule()`
- `registerPrompt(name, prompt)`
- `restoreDefaultPrompts()`
- `ui.Prompt`
- `Separator`

The built-in prompt types documented for the legacy API are `input`, `number`, `confirm`, `list`, `rawlist`, `expand`, `checkbox`, `password`, and `editor`. The v14 source also registers `search` and `select`.

## The important v14 behavior change

In v14, an unregistered prompt `type` throws. Older examples commonly rely on unknown types falling back to `input`; do not rely on that behavior. Register a custom prompt before asking a question that uses it:

```ts pmcp-example
import inquirer from 'inquirer';
import assert from 'node:assert/strict';

assert.equal(typeof inquirer.prompt, 'function');
assert.equal(typeof inquirer.registerPrompt, 'function');
assert.equal(typeof inquirer.createPromptModule, 'function');
assert.equal(typeof inquirer.restoreDefaultPrompts, 'function');
assert.equal(typeof inquirer.Separator, 'function');
```

The registration API is:

```ts
inquirer.registerPrompt('custom', customPrompt);
const answers = await inquirer.prompt([
  { type: 'custom', ...config },
]);
```

The supplied research does not specify the custom prompt implementation contract. Use the contract required by the custom prompt package or source being integrated rather than assuming the old fallback behavior.

## Asking questions

The usual API is:

```ts
inquirer.prompt(questions, answers)
```

It returns a Promise. `questions` can be a question object, an array or map of questions, or an RxJS-compatible Observable. `answers` defaults to `{}`.

Question objects commonly use these fields:

- `type`, `name`, `message`, `default`, `choices`
- `validate`, `filter`, `transformer`, `when`
- `pageSize`, `prefix`, `suffix`
- `askAnswered`, `loop`, `waitUserInput`

Do not copy a test-runner example into a plain script. `describe`, `it`, and `expect` are not supplied by this package. A direct script must call `inquirer.prompt(...)` itself.

## Non-interactive environments

`prompt()` requires an interactive environment where `process.stdin.isTTY === true`. In a plain non-interactive process or CI process, it rejects with an error whose `isTtyError` property is true. However, invoking it in an environment that unexpectedly exposes a TTY can block waiting for input, so do not use a standalone non-interactive example to simulate a prompt.

Handle the two error categories in application code like this:

```ts
inquirer.prompt(questions)
  .then((answers) => {
    // consume answers
  })
  .catch((error) => {
    if (error.isTtyError) {
      // The prompt could not be rendered in the current environment.
    } else {
      // Another error occurred.
    }
  });
```

The actual prompt interaction must be exercised by Inquirer's tool in an interactive environment. A plain script run as `bun example.ts` cannot safely provide a fake interactive transcript.

## Prompt modules

Use `createPromptModule()` when code needs a reusable prompt function:

```ts pmcp-example
import inquirer from 'inquirer';
import assert from 'node:assert/strict';

const prompt = inquirer.createPromptModule();
assert.equal(typeof prompt, 'function');
assert.notEqual(prompt, inquirer.prompt);
```

The returned function accepts the same question input described for `inquirer.prompt`; it still requires a TTY when it is actually called.

## Separators in choices

Use `new inquirer.Separator()` in a choice list to insert a visual separator:

```ts pmcp-example
import inquirer from 'inquirer';
import assert from 'node:assert/strict';

const separator = new inquirer.Separator();
assert.ok(separator instanceof inquirer.Separator);
assert.deepEqual(['Choice A', separator, 'Choice B'].length, 3);
```

## Reactive questions

`prompt()` accepts an RxJS-compatible Observable of questions. The documented pattern is to send questions through the Observable and then complete it:

```ts
const prompts = new Rx.Subject();
inquirer.prompt(prompts);
prompts.next({ /* question */ });
prompts.complete();
```

The returned prompt exposes `ui.process.subscribe(...)`. The required RxJS-compatible Observable implementation is not part of the package surface covered by the supplied research, so no standalone executable example is provided for this form.

## Built-in prompt details and environment caveats

The built-in types include the legacy types listed above; v14 source also registers `search` and `select`.

Setting `INQUIRER_KEYBINDINGS=vim,emacs` enables user-selected keybindings. This disables `select` search.

The `editor` prompt uses the user's `$VISUAL` or `$EDITOR`, with an OS fallback: `notepad` on Windows and `vim` on Linux/macOS.

## Migration and v14 notes

- Treat `inquirer` as the legacy API; prefer `@inquirer/prompts` for the newer API when the surrounding project permits it.
- Keep the older question-object shape when maintaining existing `inquirer` code.
- Do not expect an unknown prompt type to become an `input` prompt in v14.
- v14 also fixed cursor positioning around line wraps.

## Not covered

This skill does not cover the implementation contract for custom prompt packages, the complete behavior or option set of each individual interactive prompt, an RxJS installation or Observable implementation, terminal key handling beyond the documented environment variable, or how to automate an interactive TTY. The `prompt()` and prompt-module execution paths are only safely exercised by the tool in an interactive environment; the standalone examples here cover the package surface that can be reached without interactive input.

---
name: commander
description: Use Commander 15.0.0 for ESM command-line parsing, options, arguments, subcommands, and custom option definitions.
---

Verified against commander@15.0.0 on 2026-09-07. 8 of 8 examples executed.

# Commander 15

## Runtime and module shape

Commander `^15.0.0` is ESM-only and requires Node.js `>=22.12.0`. Import from the package with ESM syntax:

```ts pmcp-example
import { strict as assert } from 'node:assert';
import { Command } from 'commander';

const command = new Command();
assert.ok(command instanceof Command);
```

Do not copy the older CommonJS shape:

```js
const { Command } = require('commander');
```

Commander 15 removed the deprecated `commander/esm.mjs` entry point. CommonJS consumers can therefore encounter module or tooling configuration problems.

## Parse a command

`program.parse(arguments)` parses the supplied argument array; when no argument is supplied, it defaults to `process.argv`. Parsed options are read with `.opts()`, and unconsumed arguments are in `.args`.

Use the documented post-v7 option-access shape by default:

```ts pmcp-example
import { strict as assert } from 'node:assert';
import { program } from 'commander';

program
  .option('--first')
  .option('-s, --separator <char>')
  .argument('<string>');

program.parse(['node', 'string-util', '--first', '-s', ':', 'a:b:c']);

const options = program.opts();
assert.equal(options.first, true);
assert.equal(options.separator, ':');
assert.deepEqual(program.args, ['a:b:c']);

const limit = options.first ? 1 : undefined;
assert.deepEqual(program.args[0].split(options.separator, limit), ['a']);
```

The split limit is a JavaScript `String.prototype.split` limit: with `--first`, a limit of `1` produces only the first substring.

The older property-access style is not the default. It is available only when explicitly enabled for unmodified legacy code:

```ts pmcp-example
import { strict as assert } from 'node:assert';
import { Command } from 'commander';

const command = new Command();
command.storeOptionsAsProperties().option('-d, --debug');
command.parse(['node', 'tool', '--debug']);

assert.equal(command.debug, true);
assert.equal(command.opts().debug, true);
```

## Define options and arguments

Use `Command` methods for straightforward definitions. A required option value uses `<value>`; an optional value uses `[value]`.

```ts pmcp-example
import { strict as assert } from 'node:assert';
import { Command } from 'commander';

const command = new Command();
command
  .name('string-util')
  .description('String utilities')
  .version('0.8.0')
  .argument('<string>')
  .option('--first')
  .option('-s, --separator <char>', 'separator character', ',');

command.parse(['node', 'string-util', '-s', ':', 'a:b:c']);
const options = command.opts();
assert.equal(command.name(), 'string-util');
assert.equal(options.separator, ':');
assert.equal(options.first, undefined);
assert.deepEqual(command.args, ['a:b:c']);
```

Actions receive parsed command arguments followed by the command options. A command with an action runs in the same process and can be exercised from a plain script:

```ts pmcp-example
import { strict as assert } from 'node:assert';
import { Command } from 'commander';

const command = new Command();
let received: unknown;
command
  .command('split')
  .argument('<string>')
  .option('--first')
  .action((value, options) => {
    received = [value, options];
  });

command.parse(['node', 'tool', 'split', '--first', 'a,b']);
assert.deepEqual(received, ['a,b', { first: true }]);
```

## Custom `Option` definitions

Use `Option` when you need defaults, allowed choices, environment variables, optional-value presets, or argument parsing. Options can also be hidden, made mutually exclusive with `.conflicts()`, or made dependent with `.implies()`.

```ts pmcp-example
import { strict as assert } from 'node:assert';
import { Command, Option } from 'commander';

const command = new Command();
command
  .addOption(new Option('-s, --secret').hideHelp())
  .addOption(new Option('-t, --timeout <delay>').default(60, 'one minute'))
  .addOption(new Option('-d, --drink <size>').choices(['small', 'medium', 'large']))
  .addOption(new Option('--donate [amount]').preset('20').argParser(parseFloat))
  .addOption(new Option('--disable-server').conflicts('timeout'))
  .addOption(new Option('--free-drink').implies({ drink: 'small' }));

command.parse(['node', 'tool', '--drink', 'large', '--donate', '3.5']);
const options = command.opts();
assert.equal(options.drink, 'large');
assert.equal(options.donate, 3.5);
assert.equal(options.timeout, 60);
```

An option can read its value from an environment variable with `.env('NAME')`:

```ts pmcp-example
import { strict as assert } from 'node:assert';
import { Command, Option } from 'commander';

const command = new Command();
command.addOption(new Option('-p, --port <number>').env('PORT'));
command.parse(['node', 'tool'], { from: 'node' });

assert.equal(command.opts().port, undefined);
```

## Constructors and factory functions

The documented root exports include `Command`, `Option`, `Argument`, `Help`, `CommanderError`, `InvalidArgumentError`, the deprecated alias `InvalidOptionArgumentError`, `program`, `createCommand`, `createOption`, and `createArgument`. The factories create the corresponding objects without requiring direct construction.

```ts pmcp-example
import { strict as assert } from 'node:assert';
import {
  Argument,
  Command,
  Option,
  createArgument,
  createCommand,
  createOption,
  program,
} from 'commander';

assert.ok(program instanceof Command);
assert.ok(new Command() instanceof Command);
assert.ok(new Option('--verbose') instanceof Option);
assert.ok(new Argument('<file>') instanceof Argument);
assert.ok(createCommand('tool') instanceof Command);
assert.ok(createOption('--verbose') instanceof Option);
assert.ok(createArgument('<file>') instanceof Argument);
```

## Subcommands

There are two different `.command()` forms:

- A command with a callback/action can be defined in the same process.
- A command with a description and no action is a stand-alone executable subcommand. Commander searches beside the entry script for names such as `command-subcommand`, tries common extensions, and launches the executable as a child process.

For stand-alone executables, declare their options in the executable itself. Top-level options are not declared for them, and the `.command()` argument syntax is the argument-declaration method available for stand-alone executables.

A stand-alone definition has this shape:

```js
program
  .command('install [package-names...]', 'install one or more packages')
  .command('update', 'update installed packages', {
    executableFile: 'myUpdateSubCommand'
  });
```

A `.ts` stand-alone executable requires invocation through Node with `ts-node`, for example `node -r ts-node/register pm.ts`.

When passing arguments through `npm run-script`, use `--`, for example `npm run-script <command> [-- <args>]`.

## Does not cover

This skill does not cover Commander APIs or behaviors not established by the supplied research, including detailed help customization, error-handling flows, asynchronous parsing, the full `Help`/error-class API, or the exact executable-discovery rules beyond the documented summary above. Stand-alone executable subcommands are not exercised by the self-contained examples because they require separate files and process invocation.

---
name: prettier
description: Apply and diagnose Prettier 3 using a project's existing configuration, language parser, ignore rules and CLI checks. Use for formatting consistency; keep syntax changes, lint rules and architectural conventions separate.
---

# Prettier 3 project formatting

Use the installed formatter and the project's package manager. The fixture
targets Prettier 3.9.9. Preserve existing options and plugin versions instead of
adding a competing configuration for one edited file.

## Choose the file and existing configuration

Use the project's format script or invoke the local CLI on owned paths. check
does not write; write mutates source. Keep generated files and dependencies under
the project's ignore policy, and review the resulting diff before delivery.

```sh
prettier --check src/component.tsx
prettier --write src/component.tsx
```

Check which configuration applies when editor and CLI results differ. Config
search starts from the source file; a command's working directory, explicit
config or ignore path can change the effective behavior. A new configuration
should be an intentional project decision rather than a workaround for one file.

## Use the asynchronous API correctly

```js
import { readFile } from "node:fs/promises";
import * as prettier from "prettier";

export async function formatFile(path) {
  const options = await prettier.resolveConfig(path);
  const source = await readFile(path, "utf8");
  return prettier.format(source, { ...options, filepath: path });
}
```

The public Prettier 3 APIs are asynchronous. Supply filepath to infer a parser,
or parser explicitly for in-memory content. format does not independently skip
ignored files; an editor integration needs getFileInfo with its intended ignore
policy before deciding to format.

Install a plugin only for a language the project needs and keep its compatibility
with the installed Prettier version explicit. The removed custom-parser function
option is not the Prettier 3 plugin API.

## Verify the formatting workflow

CLI check returns 0 when formatted, 1 for formatting differences and 2 for an
execution error. Distinguish a formatter failure from an ordinary unformatted
file. Run check after write and ensure formatting is stable on a second pass.

Prettier handles representation and width; a green result does not establish
one-statement-per-line policies, correct logic, lint cleanliness or module design.
Keep those project rules and checks alongside the formatter.

The fixture exercises configuration lookup, format idempotence, a failing CLI
check, write→check success and ignored malformed input. It does not install
plugins or rewrite the consumer's entire repository.

## Sources

- [Prettier API](https://prettier.io/docs/api)
- [CLI and exit codes](https://prettier.io/docs/cli)
- [Configuration](https://prettier.io/docs/configuration)
- [Ignoring code](https://prettier.io/docs/ignore)

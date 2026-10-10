---
name: jake
description: Use Jake 12.x task-definition APIs safely from JavaScript or TypeScript, while distinguishing import-time definitions from behavior supplied by Jake’s CLI runner.
---

Verified against jake@12.10.1 on 2026-09-08. 7 of 7 examples executed.

# jake

## Version and import

This skill targets `jake` `^12.0.0`, including the documented `12.10.1` release. The package’s main entry point is `lib/jake.js`, and importing it returns the Jake object. The package requires Node `>=10`.

Use the package directly in a script:

```ts pmcp-example
import assert from "node:assert/strict";
import jake from "jake";

assert.equal(typeof jake.task, "function");
assert.equal(typeof jake.file, "function");
assert.equal(typeof jake.namespace, "function");
assert.equal(typeof jake.series, "function");
```

The documented task-definition functions include `task`, `rule`, `directory`, `file`, `desc`, `namespace`, `complete`, `fail`, `packageTask`, `publishTask`, `npmPublishTask`, `testTask`, `setTaskTimeout`, `setSeriesAutoPrefix`, and `series`.

## Define ordinary tasks

The established API is `task(name, [prerequisites], [action])`. The action can be an ordinary function, an async function, or a function returning a Promise. Define prerequisites by name when they must run before the action.

```ts pmcp-example
import assert from "node:assert/strict";
import { desc, task } from "jake";

let ran = false;

desc("A task defined by an embedded Jake program.");
task("prepare", () => {
  ran = true;
});
task("build", ["prepare"], async () => {
  assert.equal(ran, false);
  await Promise.resolve();
});

assert.equal(typeof task, "function");
assert.equal(typeof desc, "function");
```

Defining a task does not, by itself, demonstrate CLI execution or prerequisite execution. Those behaviors require Jake’s runner.

## File and directory tasks

Use `file` for a file-oriented task and `directory` for a directory-oriented task. A file task accepts a name, optional prerequisites, and an action. A directory task can be declared with its directory name.

```ts pmcp-example
import assert from "node:assert/strict";
import { desc, file } from "jake";

let actionDefined = false;

desc("Build a production file.");
file("foo-production.js", ["bar", "foo-bar.js", "foo-baz.js"], () => {
  actionDefined = true;
});

assert.equal(actionDefined, false);
assert.equal(typeof file, "function");
```

The file action is associated with the task definition; it is not run merely because the definition is imported.

```ts pmcp-example
import assert from "node:assert/strict";
import { desc, directory } from "jake";

desc('Declare the directory task "bar".');
directory("bar");

assert.equal(typeof directory, "function");
assert.equal(typeof desc, "function");
```

## Namespaces

Use `namespace(name, callback)` to group task definitions. Tasks declared inside the callback are namespace-scoped, such as `foo:bar` in the documented shape.

```ts pmcp-example
import assert from "node:assert/strict";
import { desc, namespace, task } from "jake";

let defined = false;

namespace("foo", () => {
  desc("The foo:bar task.");
  task("bar", () => {
    defined = true;
  });
});

assert.equal(defined, false);
assert.equal(typeof namespace, "function");
```

The callback defines the task; it does not execute the task action.

## Compose functions with `series`

`series` composes functions for sequential execution. The documentation labels this API experimental.

```ts pmcp-example
import assert from "node:assert/strict";
import { series } from "jake";

const events: string[] = [];
const clean = () => {
  events.push("clean");
};
const lint = async () => {
  events.push("lint");
};
const build = () => {
  events.push("build");
};

const composed = series(clean, lint, build);
assert.equal(typeof composed, "function");

await composed();
assert.deepEqual(events, ["clean", "lint", "build"]);
```

Because this API is experimental, prefer the established `task` form when task-definition compatibility is the priority.

## Exported-function task shape

Jake also documents an alternative, experimental form in which exported functions implicitly become tasks:

```ts pmcp-example
import assert from "node:assert/strict";
import { series } from "jake";

function clean() {}
async function lint() {}
function internalBuild() {}

const exportedTasks = {
  clean,
  lint,
  build: series(clean, lint, internalBuild),
};

assert.equal(typeof exportedTasks.clean, "function");
assert.equal(typeof exportedTasks.lint, "function");
assert.equal(typeof exportedTasks.build, "function");
```

The exported-function task API and `series` are documented as experimental. Do not confuse this newer shape with the older and still explicitly documented `task(name, prerequisites, action)` API.

## Runner-only behavior

Jake is primarily a CLI tool, but its task APIs can be embedded in another program. Importing the package and defining tasks is usable in a plain script; task discovery, task listing, prerequisite execution, and normal CLI invocation require Jake’s runner.

The CLI shape is:

```text
jake [options ...] [env variables ...] target
```

When invoked as a runner, Jake searches for `Jakefile`, `Jakefile.js`, `jakefile`, or `jakefile.js`. If it does not find one, it searches parent directories up to the filesystem root and errors if none is found. It automatically loads `.js` files from `jakelib` after the main Jakefile; `-J`/`--jakelibdir` overrides that directory.

Do not put `describe`, `it`, or `expect` in a directly executed example: they are not provided by Jake’s package import. Likewise, do not assume that merely importing a Jakefile executes its tasks.

## What this skill does not cover

- The exact signatures or behavior of the exposed classes and helpers beyond the documented task-definition surface.
- The signatures of `run`, `parseAllTasks`, `attemptRule`, `createTask`, or other internal/programmatic runner functions.
- Jake CLI options beyond the invocation shape and `-J`/`--jakelibdir` behavior described above.
- Filesystem effects and the actual execution order of runner-discovered tasks.
- A v12-specific migration guide: the supplied changelog has no v11 or v12 migration/change section.
- Undocumented behavior of `rule`, publishing helpers, test helpers, timeout configuration, or completion/failure signaling.

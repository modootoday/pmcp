---
name: app-builder-lib
description: Practical app-builder-lib ^26.0.0 API guidance for programmatic use, with runnable checks for architecture and platform helpers and cautions about packaging-only APIs.
---

Verified against app-builder-lib@26.15.3 on 2026-09-08. 2 of 2 examples executed.

# app-builder-lib (`^26.0.0`)

`app-builder-lib` is the library layer used by electron-builder. The `^26.0.0` range means the v26 API line, including later 26.x releases; do not assume behavior is limited to 26.0.0.

## Directly usable helpers

The simplest standalone surface is the architecture and platform API.

```ts pmcp-example
import assert from "node:assert/strict";
import { Arch, archFromString } from "app-builder-lib";

assert.equal(Arch.ia32, 0);
assert.equal(Arch.x64, 1);
assert.equal(Arch.armv7l, 2);
assert.equal(Arch.arm64, 3);
assert.equal(Arch.universal, 4);

assert.equal(archFromString("ia32"), Arch.ia32);
assert.equal(archFromString("x64"), Arch.x64);
assert.equal(archFromString("armv7l"), Arch.armv7l);
assert.equal(archFromString("arm64"), Arch.arm64);
assert.equal(archFromString("universal"), Arch.universal);
```

`Platform` provides predefined Linux, macOS, and Windows values, conversion from a platform name, the current platform, and target-map construction. Use the predefined values or `Platform.fromString()` rather than recreating platform instances unnecessarily. A common shape mistake is assuming that the Windows platform's string form is `"win"`; `Platform.fromString("win")` accepts that name, but `Platform.WINDOWS.toString()` returns `"windows"`.

```ts pmcp-example
import assert from "node:assert/strict";
import { Arch, Platform } from "app-builder-lib";

assert.equal(Platform.fromString("linux"), Platform.LINUX);
assert.equal(Platform.fromString("mac"), Platform.MAC);
assert.equal(Platform.fromString("win"), Platform.WINDOWS);

assert.equal(Platform.LINUX.toString(), "linux");
assert.equal(Platform.MAC.toString(), "mac");
assert.equal(Platform.WINDOWS.toString(), "windows");
assert.ok([Platform.LINUX, Platform.MAC, Platform.WINDOWS].includes(Platform.current()));

const targets = Platform.LINUX.createTarget(undefined, Arch.x64);
assert.ok(targets instanceof Map);
assert.ok(targets.has(Platform.LINUX));
assert.deepEqual(targets.get(Platform.LINUX)?.get(Arch.x64), []);
```

`Platform.createTarget(type?, ...archs)` returns a `Map<Platform, Map<Arch, string[]>>`. Its first argument may be a target type, a target-type array, or `null`; architecture arguments select architectures for the target map.

## Programmatic packaging API

The exported functions include:

- `build(options, packager?)`, returning `Promise<string[]>`.
- `buildForge(forgeOptions, options)`, returning `Promise<string[]>`.
- `checkBuildRequestOptions`.
- `combineSignResults` and `isSignResultSigned`.
- `getArchSuffix`.

The public classes include `Packager`, `PlatformPackager`, `Target`, `AppInfo`, `CancellationToken`, `PublishManager`, platform-specific packagers, and signing managers. `new Packager(options, cancellationToken?)` and the packager's `build(repositoryInfo?)` are documented programmatic entry points. `PackagerOptions` can include configuration, `projectDir`, `targets`, `prepackaged`, and platform target arrays.

These APIs are not ordinary pure helpers: packaging requires a build context, project/application inputs, output directories, targets, and often downloaded or cached toolsets. A plain script with no filesystem, network, project, or tool-runner setup cannot execute a real packaging build. Do not use `describe`, `it`, `expect`, or CLI-only configuration syntax in a direct script.

`Target` is an abstract build participant. Its `build(appOutDir, arch)` method is implemented by concrete target packages; it is not a general-purpose standalone installer function. Platform packagers likewise receive build context, and hooks receive a `PlatformPackager`, not merely a filesystem path.

## v26-specific cautions

- Publishing files were refactored to `electron-publish` in 26.0.0. Code that assumes publishing internals live in their older locations is stale.
- In 26.0.1, non-external `ObjectMap` shapes changed to `Record`. Prefer the current typed configuration shape rather than copying an older major's `ObjectMap` declarations.
- Squirrel.Windows changed implementation in 26.0.3 to use `electron-winstaller` instead of the package's former self-contained implementation.
- Windows signing changed in 26.0.7: the vendor directory is signed instead of using Squirrel.Windows' signing method.
- Parallel packaging of architectures and targets became configurable with the `concurrency` configuration property in 26.0.13.
- TypeScript configuration loading uses `jiti` from 26.4.1. Electron download handling moved to `@electron/get` in 26.10.0.
- `^26.0.0` can resolve any later 26.x release, so account for these later-v26 changes when diagnosing behavior.

## What this skill does not cover

This skill does not specify the full `Configuration`, target-specific option, signing, publishing, Forge, hook, toolset, or platform-packager contracts beyond identifying their public existence. It does not provide a runnable packaging example because the supplied research requires project files, build context, toolsets, and potentially downloads, which are unavailable to the required filesystem-free, network-free example runner. It also does not cover CLI invocation syntax or behavior outside the documented programmatic API.

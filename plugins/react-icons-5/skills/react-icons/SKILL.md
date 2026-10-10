---
name: react-icons
description: Use react-icons v5 icon-pack subpath imports, core component types, context, and documented packaging boundaries without relying on obsolete pre-v3 imports or unavailable manifest paths.
---

Verified against react-icons@5.7.0 on 2026-09-07. 3 of 3 examples executed.

# react-icons

## Version and package boundary

This skill targets `react-icons` `^5.0.0`, which stays within major version 5. The researched documented release is 5.7.0. React is a peer dependency, and the package publishes CommonJS, ES module, and TypeScript entry points. It declares `sideEffects: false`.

The icons are React components. Normal usage belongs in a React application or another React renderer. The standalone examples below create React elements and inspect the exported API; they do not attempt to render into a browser or server output.

## Import icons from an icon-pack subpath

Use a named import from the pack subpath:

```tsx
import { FaBeer } from "react-icons/fa";
```

The same pattern applies to other packs, for example:

```tsx
import { ICON_NAME } from "react-icons/md";
```

The documented pack subpaths include `ai`, `bi`, `bs`, `cg`, `ci`, `di`, `fa`, `fa6`, `fc`, `fi`, `gi`, `go`, `gr`, `hi`, `hi2`, `im`, `io`, `io5`, `lia`, `lu`, `md`, `pi`, `ri`, `rx`, `si`, `sl`, `tb`, `tfi`, `ti`, `vsc`, and `wi`.

A typical React usage is:

```tsx
import { FaBeer } from "react-icons/fa";

function Question() {
  return <h3>Lets go for a <FaBeer />?</h3>;
}
```

### Common import mistake

Do not use the old pre-v3 per-file form:

```tsx
import FaBeer from "react-icons/lib/fa/beer";
```

That shape was replaced by the named per-pack import:

```tsx
import { FaBeer } from "react-icons/fa";
```

The v4-shaped named subpath imports remain the documented v5 shape. The v5.0.0 release specifically documents strict ESM loader compatibility rather than a new icon import migration.

### Standalone import check

```ts pmcp-example
import assert from "node:assert/strict";
import { createElement } from "react";
import { FaBeer } from "react-icons/fa";

assert.equal(typeof FaBeer, "function");

const element = createElement(FaBeer, { title: "Beer" });
assert.equal(element.type, FaBeer);
assert.equal(element.props.title, "Beer");
```

## Core component API

The core API exposes these types and functions:

- `IconTree`: `{ tag, attr, child }` tree data for an icon.
- `GenIcon(data)`: creates an icon component from an `IconTree`.
- `IconBase`: the base SVG component.
- `IconType`: a component accepting `IconBaseProps`.
- `IconBaseProps`: React SVG attributes plus optional `children`, `size`, `color`, and `title`.

The core exports are available from `react-icons` and `react-icons/lib` according to the package declarations. `GenIcon` is useful when icon tree data is available programmatically; normal consumers should generally import generated icons from their pack subpath.

`size` accepts a string or number. `color` and `title` are also supported alongside normal React SVG attributes.

```ts pmcp-example
import assert from "node:assert/strict";
import { createElement } from "react";
import { GenIcon } from "react-icons";

const Icon = GenIcon({
  tag: "path",
  attr: { d: "M0 0h10v10H0z" },
  child: [],
});

assert.equal(typeof Icon, "function");
const element = createElement(Icon, { size: 24, color: "blue", title: "Square" });
assert.equal(element.type, Icon);
assert.equal(element.props.size, 24);
assert.equal(element.props.color, "blue");
assert.equal(element.props.title, "Square");
```

## Global icon context

Import `IconContext` and provide values around icons in a React tree:

```tsx
import { IconContext } from "react-icons";

<IconContext.Provider value={{ color: "blue", className: "global-class-name" }}>
  <div><FaFolder /></div>
</IconContext.Provider>
```

The context value can contain:

- `color?: string`
- `size?: string`
- `className?: string`
- `style?: React.CSSProperties`
- `attr?: React.SVGAttributes<SVGElement>`

`DefaultContext` is also exported. The context is a React context object, so provide it through React rather than treating it as a standalone plain-object configuration API.

```ts pmcp-example
import assert from "node:assert/strict";
import { createElement } from "react";
import { DefaultContext, IconContext } from "react-icons";

assert.equal(typeof IconContext.Provider, "object");
assert.equal(typeof DefaultContext, "object");

const child = createElement("span", null, "icon");
const provider = createElement(
  IconContext.Provider,
  { value: { color: "blue", className: "global-class-name" } },
  child,
);

assert.equal(provider.type, IconContext.Provider);
assert.equal(provider.props.value.color, "blue");
assert.equal(provider.props.value.className, "global-class-name");
```

## Manifest declarations and runtime path

The research describes an `IconManifestType` with these fields:

```ts
interface IconManifestType {
  id: string;
  name: string;
  projectUrl: string;
  license: string;
  licenseUrl: string;
}
```

It also documents an `IconsManifest` declaration. However, the documented declaration path `react-icons/lib/iconsManifest` is not a runnable runtime module in the tested `react-icons@5.7.0` installation. Do not make application code depend on that path without verifying the installed package exposes it. Manifest inspection is therefore not covered by a standalone example here.

## Installation and packaging notes

The standard installation is:

```sh
npm install react-icons --save
```

or:

```sh
yarn add react-icons
```

There is also an `@react-icons/all-files` package with imports such as:

```tsx
import { FaBeer } from "@react-icons/all-files/fa/FaBeer";
```

The researched documentation describes it as a separate, slower-to-install option for environments such as Meteor or Gatsby and warns that it has not had a new release for some time. Prefer the standard `react-icons` package unless that separate packaging mode is specifically required.

## What this skill does not cover

- Rendering icons in a browser, server-rendering, or framework-specific integration.
- The behavior of every individual icon or icon-pack export.
- Choosing an icon by visual appearance or searching the manifest.
- Using `IconsManifest` at a runtime path not present in the tested installation.
- The internal SVG rendering details of `IconBase`.
- Building or modifying the icon database and repository development commands.
- The `@react-icons/all-files` package beyond its documented import shape.
- Any API or behavior not shown in the supplied v5 research.

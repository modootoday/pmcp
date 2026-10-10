---
name: tailwindcss
description: Configure and diagnose Tailwind CSS 4 CSS-first themes, source detection, complete utility tokens and Vite/PostCSS/CLI package boundaries. Use for installed Tailwind 4 projects and explicit migrations from Tailwind 3.
---

# Tailwind CSS 4

Read the installed versions and the application's browser support policy.
Tailwind 4 targets modern CSS features and requires Safari 16.4+, Chrome 111+
and Firefox 128+. Keep Tailwind 3.4 when the product still needs older browsers.
The fixture uses tailwindcss and @tailwindcss/vite 4.3.3 with Vite 8.2.2.

## Select the existing integration

For Vite, configure @tailwindcss/vite alongside the application's other plugins:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
```

For PostCSS, use @tailwindcss/postcss; tailwindcss itself is no longer the
PostCSS plugin. CLI usage belongs to @tailwindcss/cli. Choose one appropriate
integration rather than processing the same stylesheet through multiple paths.

The Vite fixture verifies that integration only. PostCSS and CLI instructions
must not be described as executed by it.

## Define themes and source boundaries

Import Tailwind from the application's stylesheet. Use @theme for design tokens
that should generate utilities, and regular CSS variables for values that do not
need that utility-generation contract:

```css
@import "tailwindcss";
@theme {
  --color-accent: #135790;
}
```

Tailwind scans source as text and needs complete class tokens. Prefer explicit
class lookup tables over constructing partial strings. Check the scan root and
ignored paths when utilities from a workspace dependency are missing. @source
can include a path not discovered automatically and is relative to the stylesheet.

For a tightly scoped stylesheet, opt out of automatic discovery deliberately:

```css
@import "tailwindcss" source(none);
@source './src';
```

Do not apply this restricted source boundary globally without checking the
application's other templates and shared components.

## Migrate only within the requested scope

Review changes in default border/ring colors, shadow/radius scales, outline
behavior, variants and removed utilities. A stylesheet compiling successfully
does not establish visual equivalence. JavaScript configuration is not discovered
automatically; a retained config needs the documented @config integration, and
not all Tailwind 3 options are supported unchanged.

Keep the project's cascade and third-party stylesheet ordering deliberate. For
layout changes, verify generated selectors and computed styles in a supported
browser. The fixture checks the Vite production build, source detection and a
custom theme utility; it does not establish appearance, responsive breakpoints
or compatibility with every application stylesheet.

## Sources

- [Tailwind Vite installation](https://tailwindcss.com/docs/installation/using-vite)
- [Tailwind PostCSS installation](https://tailwindcss.com/docs/installation/using-postcss)
- [Source detection](https://tailwindcss.com/docs/detecting-classes-in-source-files)
- [Theme variables](https://tailwindcss.com/docs/theme)
- [Upgrade guide](https://tailwindcss.com/docs/upgrade-guide)

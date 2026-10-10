---
name: tailwindcss
description: Configure and diagnose Tailwind CSS 3 utility generation, content paths, complete class names, theme extensions and PostCSS integration. Use for an installed Tailwind 3 project rather than applying Tailwind 4's CSS-first configuration or separate plugin packages.
---

# Tailwind CSS 3

Inspect the installed major, CSS entrypoint and build integration. The fixture
uses Tailwind CSS 3.4.19 with PostCSS 8.5.28. Keep an existing 3.x application on
its current major unless the task explicitly includes migration.

## Find missing utilities

Tailwind detects complete class-name tokens in configured content files. Include
the actual source extensions and relevant shared-package source files. Content
paths are normally relative to the process working directory; use relative: true
when the configuration needs them resolved relative to the config file.

```js
export default {
  content: {
    relative: true,
    files: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  },
  theme: {
    extend: { colors: { accent: "#135790" } },
  },
};
```

Use complete variants in a lookup table instead of constructing strings such as
bg-${color}-500. Safelist a bounded known set only when source discovery cannot
see the actual tokens. A database-supplied arbitrary class is not discovered at
build time merely because it will appear at runtime.

## Match the build integration

The Tailwind 3 package itself is the PostCSS plugin. Preserve the project's
existing PostCSS configuration, including any required autoprefixer integration.
The CSS entrypoint uses:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

The Tailwind 3 CLI also ships in tailwindcss. Run the existing project script
instead of installing a latest CLI that may belong to another major.

Extend the theme rather than replace default sections accidentally. Use @layer
for custom component or utility definitions when the intended cascade requires
them. Check generated CSS before blaming JSX or the browser for a missing class.

## Verify the result

Run the real build, inspect the generated selector for the relevant class and
check the application's computed browser styles when the change affects layout
or appearance. The PostCSS fixture checks source-selected utilities, a theme
extension, a hover variant and exclusion of an unused utility. It does not
establish responsive layout or accessibility.

Tailwind 4 uses different packages and CSS-first configuration. Its browser floor
also differs; keeping 3.4 is appropriate when the application's browser support
cannot meet the Tailwind 4 requirements.

## Sources

- [Tailwind 3 content configuration](https://v3.tailwindcss.com/docs/content-configuration)
- [Tailwind 3 PostCSS integration](https://v3.tailwindcss.com/docs/installation/using-postcss)
- [Tailwind 3 theme configuration](https://v3.tailwindcss.com/docs/theme)
- [Tailwind 4 migration and browser requirements](https://tailwindcss.com/docs/upgrade-guide)

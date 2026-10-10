---
name: vitejs-plugin-react
description: Configure @vitejs/plugin-react 5 for a React application using Vite, diagnose JSX and Fast Refresh boundaries, and maintain version-specific Babel options. Use the installed plugin's peer range rather than copying plugin-react 6 configuration into Vite 7.
---

# Vite React plugin 5

The fixture uses @vitejs/plugin-react 5.2.0 with Vite 7.3.6 and React 19.2.8.
Check the installed plugin's peer range. Version 5.2.0 accepts Vite 4–8, but a
major-wide claim must not assume earlier plugin patches have the same range.
Plugin 6 requires Vite 8 and changes the Babel configuration surface.

## Configure through Vite

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
});
```

Use the automatic JSX runtime unless the application's existing integration needs
the classic runtime. Preserve the node_modules exclusion. Expand include only for
source types that another plugin converts appropriately, such as MDX. This plugin
is not a standalone JSX transpiler or a test runner.

## Keep Babel options in their version boundary

Plugin 5 supports a babel option. Add a Babel plugin only for a demonstrated
transform requirement and install that plugin explicitly:

```ts
react({
  babel: {
    plugins: ["babel-plugin-react-compiler"],
  },
});
```

React Compiler use is a separate compiler adoption decision. The ordinary build
fixture does not exercise it. In plugin 6 the babel option is removed; use its
documented separate @rolldown/plugin-babel integration when working on that major.

## Diagnose Fast Refresh

Fast Refresh needs the HTML preamble. Vite's normal HTML flow injects it;
custom SSR HTML serving must call transformIndexHtml or use the documented
@vitejs/plugin-react/preamble entry through Vite. A manifest's types declaration
for that entry does not describe the complete Vite-resolved runtime behavior.
Do not import it as a standalone Node utility.

Keep component exports stable. Mixed component and noncomponent exports can
invalidate a Refresh boundary and propagate updates; inspect the exported values
and the application's Refresh lint rules before treating this as a state bug.

For a plugin configuration change, verify a real Vite build and development TSX
transformation. For interactive Refresh or SSR changes, use an actual browser and
the application's server integration. Merely obtaining a plugin array does not
exercise those behaviors.

## Sources

- [Vite React plugin 5 source](https://github.com/vitejs/vite-plugin-react/tree/plugin-react%405.2.0/packages/plugin-react)
- [Plugin 5.2.0 package metadata](https://registry.npmjs.org/%40vitejs%2Fplugin-react/5.2.0)
- [Vite JavaScript API](https://v7.vite.dev/guide/api-javascript)

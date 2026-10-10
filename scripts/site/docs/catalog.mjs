import { guides } from "../guides/catalog.mjs";

export const documents = [
  { route: "/guide/", title: "Getting started", description: "Install PMCP and connect the native runtime you already use.", source: "guide.html" },
  { route: "/install/", title: "Installation", description: "Runtime requirements, dependencies and native MCP installation.", source: "install.html" },
  ...guides,
  { route: "/authoring/", title: "Authoring skills", description: "Ship SKILL.md instructions in a package and make them discoverable.", source: "authoring.html" },
  { route: "/commands/", title: "Command reference", description: "PMCP command flags, behavior and exit codes.", source: "commands.html" },
  { route: "/compare/", title: "Working model", description: "Understand on-demand discovery and local package instructions.", source: "compare.html" },
  { route: "/licence/", title: "Licence", description: "Elastic License 2.0 and third-party dependency notices.", source: "licence.html" },
];

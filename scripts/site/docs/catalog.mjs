import { guides } from "../guides/catalog.mjs";

// Getting started leads the menu and the references close it; the other guides keep their order.
const LATE = ["/commands/", "/compatibility/", "/glossary/"];
const guide = (route) => guides.find((entry) => entry.route === route);

export const documents = [
  guide("/guide/"),
  { route: "/install/", title: "Installation", description: "Runtime requirements, dependencies and native MCP installation.", source: "install.html" },
  ...guides.filter((entry) => entry.route !== "/guide/" && !LATE.includes(entry.route)),
  { route: "/authoring/", title: "Authoring skills", description: "Ship SKILL.md instructions in a package and make them discoverable.", source: "authoring.html" },
  ...LATE.map(guide),
  { route: "/compare/", title: "Working model", description: "Understand on-demand discovery and local package instructions.", source: "compare.html" },
  { route: "/licence/", title: "Licence", description: "Elastic License 2.0 and third-party dependency notices.", source: "licence.html" },
];

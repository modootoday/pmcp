import { guides } from "../guides/catalog.mjs";

// Getting started leads the menu and the references close it; the other guides keep their order.
const EARLY = ["/guide/", "/install/"];
const LATE = ["/authoring/", "/commands/", "/compatibility/", "/glossary/", "/compare/"];
const guide = (route) => guides.find((entry) => entry.route === route);

export const documents = [
  ...EARLY.map(guide),
  ...guides.filter((entry) => !EARLY.includes(entry.route) && !LATE.includes(entry.route)),
  ...LATE.map(guide),
  { route: "/licence/", title: "Licence", description: "Elastic License 2.0 and third-party dependency notices.", source: "licence.html" },
];

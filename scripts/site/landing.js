import { mountHero } from "./home/hero/controller.js";
import { mountHome } from "./home/controller.js";
import { mountExamples } from "./examples/controller.js";
import { mountSkillCatalog } from "./skills/controller.js";

const root = document.querySelector("[data-hero-workspace]");
if (root) mountHero(root);
if (document.querySelector("#intro"))
  mountHome(document.querySelector("#main"));
for (const example of document.querySelectorAll(
  "[data-examples], .examples-page",
))
  mountExamples(example);
mountSkillCatalog(document.querySelector("#main"));
window.addEventListener("pageshow", (event) => {
  if (event.persisted && root) mountHero(root);
});

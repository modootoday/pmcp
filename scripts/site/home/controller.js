import { features, installationSteps, runtimes } from "./model.js";

export function mountHome(root) {
  let runtime = "codex";
  let step = 0;
  const code = root.querySelector("#install-code");
  const status = root.querySelector("#copy-status");

  function renderInstall() {
    const installation = installationSteps(runtime)[step];
    code.textContent = installation.code;
    root.querySelector("#install-file").textContent = installation.file;
    root.querySelector("#install-note").textContent = installation.note;
    for (const button of root.querySelectorAll("[data-install]"))
      button.setAttribute(
        "aria-pressed",
        String(Number(button.dataset.install) === step),
      );
    status.textContent = "";
  }

  for (const button of root.querySelectorAll("[data-runtime]"))
    button.addEventListener("click", () => {
      runtime = button.dataset.runtime;
      const selected = runtimes.find((entry) => entry.id === runtime);
      for (const label of root.querySelectorAll(".selected-runtime"))
        label.textContent = selected.name;
      for (const choice of root.querySelectorAll("[data-runtime]"))
        choice.setAttribute(
          "aria-pressed",
          String(choice.dataset.runtime === runtime),
        );
      renderInstall();
    });
  for (const button of root.querySelectorAll("[data-install]"))
    button.addEventListener("click", () => {
      step = Number(button.dataset.install);
      renderInstall();
    });
  for (const button of root.querySelectorAll("[data-feature-tab]"))
    button.addEventListener("click", () => {
      const feature = features.find(
        (entry) => entry.id === button.dataset.featureTab,
      );
      root.querySelector("#feature-scope").textContent = feature.scope;
      root.querySelector("#feature-title").textContent = feature.title;
      root.querySelector("#feature-description").textContent =
        feature.description;
      root.querySelector("#feature-code").textContent = feature.code;
      const base = document.documentElement.dataset.basepath ?? "";
      root.querySelector("#feature-link").href = `${base}/${feature.guide}`;
      for (const choice of root.querySelectorAll("[data-feature-tab]"))
        choice.setAttribute("aria-pressed", String(choice === button));
    });
  root.querySelector("#copy-install").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code.textContent);
      status.textContent = "Copied.";
    } catch {
      status.textContent = "Select and copy the command above.";
    }
  });
  renderInstall();
}

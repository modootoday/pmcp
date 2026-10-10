export function mountExamples(root) {
  const input = root.querySelector("[data-example-search]");
  const results = [...root.querySelectorAll("[data-example-result]")];
  const empty = root.querySelector("[data-example-empty]");
  if (!input) return;
  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();
    for (const result of results)
      result.hidden = !result.dataset.search.includes(query);
    empty.hidden = results.some((result) => !result.hidden);
  });
}

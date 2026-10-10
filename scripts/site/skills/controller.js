export function mountSkillCatalog(root) {
  const input = root.querySelector("[data-skill-search]");
  if (!input) return;
  input.hidden = false;
  const rows = [...root.querySelectorAll("[data-skill-row]")];
  const count = root.querySelector("#skills-count");
  const empty = root.querySelector("[data-skill-empty]");
  function filter() {
    const query = input.value.trim().toLowerCase();
    let visible = 0;
    for (const row of rows) {
      row.hidden = !row.dataset.search.includes(query);
      if (!row.hidden) visible += 1;
    }
    count.textContent = `${visible} of ${rows.length} skill lines`;
    empty.hidden = visible !== 0;
  }
  input.value = new URL(location.href).searchParams.get("q") ?? "";
  input.addEventListener("input", filter);
  filter();
}

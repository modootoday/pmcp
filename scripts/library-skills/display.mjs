export function skillDisplayTitle(targets) {
  if (!Array.isArray(targets) || !targets.length) {
    throw new Error("Skill display titles require at least one target");
  }
  const names = targets.map((target) => {
    const name = target?.packageName;
    if (typeof name !== "string" || !name || name !== name.trim()) {
      throw new Error("Skill display titles require nonempty package names");
    }
    return name;
  });
  return [...new Set(names)].sort().join(" + ");
}

export function validateSkillDisplayTitles(entries) {
  const products = new Map();
  for (const entry of entries) {
    const title = skillDisplayTitle(entry.targets);
    if (entry.title !== title) {
      throw new Error(`Noncanonical public skill title: ${entry.productId}`);
    }
    const previous = products.get(entry.productId);
    if (previous !== undefined && previous !== title) {
      throw new Error(
        `Public skill title differs across majors: ${entry.productId}`,
      );
    }
    products.set(entry.productId, title);
  }
}

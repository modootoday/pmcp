export function sourceFor(id: string): string {
  if (id.startsWith("custom.")) return "hooks.guards.custom";
  if (id.startsWith("checks.")) return "hooks." + id;
  if (
    id.startsWith("sessions.") ||
    id.startsWith("git.worktrees") ||
    id === "git.shared_checkout" ||
    id === "git.mainline.deliver"
  )
    return id;
  return "hooks.guards." + id;
}

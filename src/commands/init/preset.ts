import { stringify } from "smol-toml";
import { detect } from "../../git/detect.js";

export function preset(cwd: string, kind: "solo" | "multi-session") {
  const git = detect(cwd);
  const raw: Record<string, any> = {
    targets: { tools: ["claude", "codex"] },
    hooks: {
      guards: {
        git: { stage_all: { mode: "deny" } },
        shell: { heredoc: { mode: "deny" } },
      },
    },
  };
  const reasons = [
    "targets: Claude and Codex share declarations",
    "guards: explicit-path staging and no heredocs",
  ];
  if (git) {
    raw.git = {
      enabled: "auto",
      remote: git.remote,
      mainline: { branch: git.mainline },
    };
    reasons.push(
      "git: detected checkout; remote " +
        git.remote +
        ", mainline " +
        git.mainline,
    );
  }
  if (kind === "multi-session") {
    raw.sessions = {
      store: "files",
      registry: {},
      pause: { mode: "deny" },
      broadcast: {},
    };
    reasons.push(
      "sessions: shared registry, pause and broadcasts for concurrent sessions",
    );
    if (git) {
      raw.git.worktrees = {};
      raw.git.shared_checkout = { enabled: "auto" };
      reasons.push(
        "linked worktrees: worktree commands and shared-checkout warnings; no install or gate command invented",
      );
    }
  }
  return { content: stringify(raw), reasons };
}

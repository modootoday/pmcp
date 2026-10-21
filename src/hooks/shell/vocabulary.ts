// Share shell vocabulary so policy classifiers cannot disagree on command meaning.

export const WRAPPERS: ReadonlySet<string> = new Set([
  "env",
  "timeout",
  "nohup",
  "nice",
  "command",
  "exec",
  "time",
  "sudo",
  "stdbuf",
  "xargs",
]);
export const SHELLS: ReadonlySet<string> = new Set([
  "bash",
  "sh",
  "zsh",
  "dash",
]);
export const GIT_VALUE_OPTIONS: ReadonlySet<string> = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path",
]);
export const GIT_MUTATING: ReadonlySet<string> = new Set([
  "commit",
  "push",
  "merge",
  "rebase",
  "reset",
  "checkout",
  "switch",
  "cherry-pick",
  "revert",
  "am",
  "stash",
  "tag",
  "clean",
  "restore",
  "rm",
  "mv",
]);
export const BUN_INSTALLS: ReadonlySet<string> = new Set([
  "install",
  "i",
  "add",
  "remove",
  "rm",
  "update",
  "link",
]);
export const PACKAGE_MUTATING: ReadonlySet<string> = new Set([
  "install",
  "i",
  "add",
  "remove",
  "publish",
  "ci",
]);
export const DOCKER_MUTATING: ReadonlySet<string> = new Set([
  "compose",
  "build",
  "push",
  "run",
  "rm",
  "stop",
  "restart",
]);
export const WRANGLER_MUTATING: ReadonlySet<string> = new Set([
  "deploy",
  "publish",
  "secret",
]);

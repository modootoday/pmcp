# src/git rules

Multi-session git workflow: worktrees, delivery to the mainline, main checkout sync.

- Every feature is opt-in. A missing `[git]` table, or `enabled = false`, turns the whole
  workflow off; a missing sub-table turns its command off. Keys stay snake_case as in
  docs/git-workflow.md; an unknown key is a config error.
- Nothing here encodes a workspace. Gate, install, bootstrap and notify are configured argv
  lists; never add a package manager, path or env name of one repository to code.
- Only these commands mutate: `pmcp git worktree create|sync`, `pmcp git deliver`,
  `pmcp git sync`. Hooks may read git state through `detect.ts` and `landed.ts`, never call
  the mutating modules.
- Never lose work. A worktree moves only when it is clean and every ahead commit is a landed
  copy per `git cherry`; the main checkout moves only with `reset --keep` after the same
  check and with no git operation in progress. A submodule moves only when clean and on its
  old pin, and only to a commit it can reach.
- Delivery replays in a temporary detached worktree, gates in the persistent gate tree and
  pushes `<tip>:<mainline>` without force. The host lock is held across replay, gate and
  push. Retry only when the remote moved; any other push failure stops.
- Pause and leases are read through the `SessionGate` interface; this directory never
  writes session state except the leases it takes and releases. A pause refuses; another
  live session's lease is waited for up to `lease_wait_seconds`, then refused.
- An install runs when the lockfile hash differs from the checkout's stamp, and the stamp is
  written only after a successful install, so a failed install runs again on the next sync.
- Every git call goes through `exec.ts`, which strips repository-local git env so a call
  from inside a hook acts on the repository it names.
- Tests build temporary repositories with a bare origin; never use this repository's history.
- Assemblers (`cli.ts`, `worktrees.ts`) only wire; logic lives in one module per concern,
  each at most 250 lines.

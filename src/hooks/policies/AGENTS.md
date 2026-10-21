# src/hooks/policies

Rules for policies. Hook core rules: ../AGENTS.md.

- A policy id equals its toml path: hooks.guards.shell.in_place_edit is shell.in_place_edit in
  shell/in-place-edit.ts; [sessions.<name>] is sessions.<name> in sessions/; [git.shared_checkout]
  is git.shared_checkout in workspace/. Named tables ([sessions.leases.<name>], [sessions.roles.<name>])
  compile into one policy whose options hold every name.
- The registry runs first in every call so later policies see the session's record.
- Policies read the neutral HookInput only and never import runtimes.
- Shell policies judge classified steps (argv after wrappers), not command text, so a command that
  only mentions a step passes. When steps are absent the command could not be read: judge the text
  and fail closed.
- evaluate returns the policy's own severity; dispatch applies the configured mode. Only a policy
  whose default mode is graded may return both ask and deny.
- options() validates toml options at compile time and again in the hook; unknown keys throw.
- Every policy has allow and deny cases replayed through recorded Claude and Codex payloads in
  __tests__/hooks/policies/<group>/.

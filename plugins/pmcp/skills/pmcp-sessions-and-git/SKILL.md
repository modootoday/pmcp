---
name: pmcp-sessions-and-git
description: Work alongside other agent sessions in a pmcp repository - read who is working and what is held with pmcp sessions status, pause, resume and broadcast when the user asks, wait out a lease, work in a linked worktree instead of the shared main checkout, deliver commits through pmcp git deliver rather than git push, sync the main checkout and linked worktrees, and read pmcp logs to explain a hook refusal. Use when a pmcp hook refused or warned, when several agents share one repository, when asked to deliver work, or when a session reports a pause, lease or leftover edits. Not for writing pmcp.toml (set the project up first) or for repositories without pmcp hooks.
metadata:
  tier: open
  level: L2
  domain: agent-workflow
  install: optional
  keywords: "pmcp, sessions, pause, broadcast, lease, worktree, desk, deliver, mainline, git sync, pmcp logs, hook refusal"
  requires-bin: "pmcp"
---

# Working with other sessions under pmcp

pmcp hooks see every session in the repository and its worktrees. They refuse or warn with
a reason that names what to do instead. Do what the reason says; never work around a
refusal with another spelling of the same command.

## Read the room first

```sh
pmcp sessions status
```

It prints each live session (its id, runtime, checkout and current tool), the pause, current
broadcasts, held leases, and files edited but not delivered in a shared checkout. Read it
before delivering anything, and whenever a hook mentions another session.

## Pause and broadcast (only when the user asks)

```sh
pmcp sessions pause "release freeze" --by operator
pmcp sessions resume
pmcp sessions broadcast "main moved; sync your worktree before delivering"
pmcp sessions unbroadcast
pmcp sessions sweep   # drop records whose process is gone
```

While paused, every other session's edits and mutating commands are refused; reading and
planning continue. A broadcast reaches each session once, as context. An agent does not
pause, resume or broadcast on its own initiative; it reports the need to the user.

## Leases

A lease protects a file two sessions must not change at once, such as a lockfile. While a
delivery that touches it is in progress, the commands listed for that lease are refused with
`... is landing ... retry when it has landed` ("landing" means being delivered). Wait and
retry; do not run the command another way.

## Linked worktrees, not the shared checkout

When the repository has worktrees, the main checkout is shared: an edit left there blocks
syncing the mainline for every session, and the hook says so. Work in a linked worktree
(hook messages call it a desk):

```sh
pmcp git worktree create <alias>     # prints the worktree path; work there
pmcp git worktree list               # alias, branch, behind/ahead, path
pmcp git worktree sync               # move this worktree onto the mainline when nothing is lost
```

If you already edited the main checkout, deliver those files within the task or move them
to a linked worktree. `pmcp sessions status` lists them under the shared checkout.

## Deliver, do not push

With `[git.mainline.deliver]`, a direct `git push` from any checkout of the repository is
refused. Commit in the linked worktree, then:

```sh
pmcp git deliver                 # every commit the upstream lacks
pmcp git deliver <commit>...     # only these
```

It fetches, replays the commits onto the mainline, runs the gate in its own tree under a
lock, and pushes, replaying again if the mainline moved. Exit 0 delivered or nothing to
deliver; 1 refused (pause, lease, gate failure, attempts exhausted) with the reason on
stderr; 2 the fetch failed. Fix what the gate reports; never bypass it with
`--no-verify` or a gate-bypass variable, which the guards refuse.

`pmcp git sync` moves the main checkout to the mainline afterwards; it refuses (exit 2)
while undelivered edits sit there.

## Explain a refusal with pmcp logs

```sh
pmcp logs --since 15m --level warn --pretty
pmcp logs --session <id-prefix> --pretty
pmcp logs --trace <trace-id>
```

Each hook call has a trace id; one trace shows every policy that ran, its verdict and
duration. Secret values, prompt text and environment values are redacted.

## Runtime differences

- Codex has no ask: a guard that would ask denies there.
- Codex sends no agent type, so roles apply only in Claude Code.
- Claude hears end-of-turn notices in the same turn; Codex at the next prompt.

## Report

What `pmcp sessions status` showed, which refusal or warning occurred and what it asked
for, the commands run instead (delivery or sync and their exit codes), and anything left for
the user (a pause to lift, a lease still held, leftovers in the shared checkout).

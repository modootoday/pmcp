# Run several agents in one repository

[Back to the overview](../README.md)

Two agents editing one checkout overwrite each other, push half-finished work or reinstall
dependencies under each other's feet. pmcp lets every agent session in a repository see the
others, and gives you the controls to coordinate them: a session list, a pause, broadcasts,
addressed messages, leases on shared files, linked worktrees and one delivery path to the
mainline. Every part is opt-in through `pmcp.toml`; the keys are in the
[pmcp.toml reference](project-configuration.md#sessions).

## See who is working

```sh
pmcp sessions status
```

It lists each live session (id, runtime, checkout and current tool), the pause, current
broadcasts, held leases, and files edited but not yet delivered in the shared checkout.
`pmcp status` adds projection drift and worktree ahead and behind counts.

## Pause and broadcast

These are your controls; an agent reports the need for them and leaves the decision to you.

```sh
pmcp sessions pause "release freeze"
pmcp sessions resume
pmcp sessions broadcast "main moved; sync your worktree before delivering"
pmcp sessions unbroadcast
pmcp sessions sweep   # drop records whose process is gone
```

While paused, every other session's edits and mutating commands are refused; reading and
planning continue. A broadcast reaches each running session once, as context. `--by <name>`
names who pauses or broadcasts; that session is exempt, and without it the sender is
`operator`.

## Send a message to one session

With `[sessions.mailbox]` declared, address a session by id, alias, role or linked worktree:

```sh
pmcp sessions send --to alias:reviewer --subject review "Please check the config change"
pmcp sessions send --to worktree:.claude/worktrees/docs --wake "Rebase onto main"
pmcp sessions inbox
```

`--wake` also starts a turn in an idle recipient where the runtime allows it (Claude Code,
opencode). This mailbox is for sessions of one repository; the [local mailbox](mailbox.md)
serves actors with their own credentials.

## Keep agents out of each other's way

- **Leases.** `[sessions.leases.<name>]` names a file two sessions must not change at once,
  such as a lockfile. While a delivery that touches it is in progress, the listed commands
  wait.
- **Linked worktrees.** `pmcp git worktree create <alias>` gives each agent its own checkout;
  an edit left in the shared main checkout blocks syncing it for everyone.
- **One delivery path.** With `[git.mainline.deliver]`, `pmcp git deliver` replays, tests and
  pushes one delivery at a time, and a direct `git push` is refused.

The [Git workflow](git-workflow.md) page covers worktrees, delivery
and sync. Agents learn the same rules from the pmcp-sessions-and-git skill in the pmcp plugin.

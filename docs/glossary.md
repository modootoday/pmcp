# Glossary

[Back to the overview](../README.md)

The words pmcp's documentation and messages use, each with the page that owns it.

| Term             | Meaning                                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| skill            | A `SKILL.md` an agent loads when its task matches: a description that decides when, and a body with the instructions. [Skills reference](skills.md)                                                                      |
| catalog          | The skills pmcp finds in installed packages, workspace packages and marketplaces; `skill_find` searches it. [Getting started](getting-started.md)                                                                        |
| marketplace      | A collection of plugins that native runtimes install; pmcp ships a free public one. [Skills reference](skills.md)                                                                                                        |
| projection       | The native files `pmcp project` writes for each tool from `pmcp.toml` and `.agents/`; `pmcp.lock` records what it owns. [Project configuration](project-configuration.md)                                                |
| hook bundle      | The guards, checks and session bookkeeping `[hooks]` compiles and every targeted runtime runs on its tool calls. [Hooks](project-configuration.md#hooks)                                                                 |
| session          | One running agent conversation in the repository, as the hooks record it. [Run several agents](sessions.md)                                                                                                              |
| shared checkout  | The repository's main checkout when linked worktrees exist; an edit left there blocks syncing it for every session.                                                                                                      |
| linked worktree  | A separate checkout `pmcp git worktree create` makes for one agent. Messages address it as `worktree:<path>`; `desk:<path>` is an older spelling that still works. [Git workflow](project-configuration.md#git-workflow) |
| mainline         | The branch deliveries go to: `[git] mainline`, else the remote's HEAD branch, else `main`.                                                                                                                               |
| delivery         | `pmcp git deliver`: replay commits onto the mainline, run the gate, push. "Being delivered" in a message means one is in progress.                                                                                       |
| gate             | The test command a delivery must pass, `[git.mainline.gate]`.                                                                                                                                                            |
| lease            | A hold on a file two sessions must not change at once, such as a lockfile; the listed commands wait while a delivery holds it.                                                                                           |
| pause            | `pmcp sessions pause`: every other session's edits and mutating commands are refused until `resume`.                                                                                                                     |
| broadcast        | Text every running session receives once, as context.                                                                                                                                                                    |
| sessions mailbox | Addressed messages between the sessions of one repository, `pmcp sessions send`. [Run several agents](sessions.md)                                                                                                       |
| local mailbox    | Messages between actors that hold their own credentials, `pmcp mailbox`, across projects and hosts. [Local mailbox](mailbox.md)                                                                                          |
| `operator`       | A name, not a role: the default sender of `pmcp sessions pause`, `broadcast` and `send` (`--by`), and a mailbox actor you may register. The docs call the person "you".                                                  |
| runtime id       | How each table names a native runtime; the ids differ between tables. [Compatibility](compatibility.md#native-runtimes)                                                                                                  |
| main and worker  | In a terminal workspace or harness group, the session you mainly talk to and the ones it delegates to. [Terminal workspace](terminal-workspace.md)                                                                       |
| harness group    | The sessions one pmcp-pty daemon hosts for `pmcp tui` or `pmcp harness`, with a budget and a generation that changes when the group is replaced. [Native terminal control](terminal-harness.md)                          |
| control          | Holding the lease on a hosted session so only you type into it; program input waits until you release it.                                                                                                                |
| host (`[host]`)  | The long-running sessions `pmcp harness host` runs from `pmcp.toml`, once you approve the projected policy. [Sessions pmcp-pty hosts](project-configuration.md#sessions-pmcp-pty-hosts)                                  |
| platform package | `@modootoday/pmcp-<os>-<cpu>`, the npm package that carries the native binaries for one platform. [Compatibility](compatibility.md)                                                                                      |

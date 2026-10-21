---
name: pmcp-project-init
description: Set up a repository so every coding agent reads the same instructions, skills, subagents, rules and MCP servers - one AGENTS.md with CLAUDE.md and GEMINI.md linked to it, sources under .agents/, a pmcp.toml with [targets] and [mcp.*] entries, then the optional layers chosen from what the repository is (hook guards, sessions, the git workflow when it is a git checkout, logging, shared MCP authentication, marketplaces), then pmcp project and pmcp doctor, plus the one-time trust step each agent CLI needs. Use when starting a new repository the pmcp way, adding pmcp to a repository that has no agent assets yet, enabling hooks, sessions or the git workflow, or when asked to write a pmcp.toml. Not for moving existing scattered agent files (migrate them instead) or for hosting a skills server.
metadata:
  tier: open
  level: L2
  domain: agent-workflow
  install: optional
  keywords: "pmcp, pmcp.toml, AGENTS.md, .agents, agent assets, project setup, MCP config, hooks, sessions, git worktrees, multi-agent repository"
  requires-bin: "pmcp"
---

# Starting a repository the pmcp way

`pmcp init [--preset solo|multi-session]` writes a starting `pmcp.toml` from what it detects
in the checkout; it refuses to replace an existing one without `--force`. You edit it and write
the other sources by hand; `pmcp project` writes every tool's native files from them, and
`pmcp doctor` asks each installed tool what it loads. Never write the generated files
yourself: pmcp refuses to overwrite a file it did not write.

Install the pmcp package as a dev dependency under the scoped name its documentation gives.
Never run the bare unscoped name through npx: that name is not the package, and whoever
publishes it later would run in your repository.

## 1. Instructions: one file, two links

```sh
printf '# <project>\n\n' > AGENTS.md
ln -s AGENTS.md CLAUDE.md
ln -s AGENTS.md GEMINI.md
```

`AGENTS.md` is the real file. Claude Code reads `CLAUDE.md` and Gemini CLI `GEMINI.md`, so
the links make them read the same text. pmcp does not create these links. Keep them
file-to-file links; a directory symlink at the repository root (for example `.agents`
pointing at another folder) is rejected by the Codex sandbox.

## 2. Sources under .agents/

| Path                             | Holds                                                       | Frontmatter                                   |
| -------------------------------- | ----------------------------------------------------------- | --------------------------------------------- |
| `.agents/skills/<name>/SKILL.md` | a skill; `<name>` equals the frontmatter `name`             | `name`, `description`                         |
| `.agents/agents/<name>/agent.md` | a subagent (directory form; a flat `<name>.md` is not read) | `name`, `description` only                    |
| `.agents/rules/<topic>.md`       | a path-scoped rule                                          | `trigger: glob`, `description`, `globs:` list |

Keep `tools`, `model` and other tool-specific fields out of `agent.md`: Antigravity drops
an agent whose `tools` names another tool's tools. Those fields go in `pmcp.toml`.

## 3. The base pmcp.toml

```toml
[targets]
tools = ["claude", "codex", "gemini", "grok", "antigravity"]

[mcp.skills]
command = "node"
args = ["${PROJECT_ROOT}/node_modules/<pmcp package>/dist/cli.js", "serve"]

[skills.release]
invocation = "user"

[agents.reviewer.claude]
tools = "Read, Grep"
model = "inherit"
```

- `[targets] tools` - any of `claude`, `codex`, `gemini`, `grok`, `antigravity`, `opencode`.
  An unknown name is an error. A tool not listed gets no files.
- `[mcp.<alias>]` - exactly one of `command` (stdio: `args`, `env`, `env_vars`, `cwd`) or
  `url` (Streamable HTTP: `headers`, `header_env`, `bearer_token_env_var`); `targets`
  narrows the tools, `tools` filters the server's tools. A value naming `${PROJECT_ROOT}`
  is launched through `sh`, so committed files carry no machine path.
- `[skills.<name>] invocation` - `"any"` (default) or `"user"`: the person starts it and the
  model is not offered it.
- `[agents.<name>.<tool>]` - fields merged into that tool's copy. Claude keeps `name`,
  `description`, `tools`, `model`, `effort`; Gemini keeps `name` and `description`.
- `[catalog]` - optional search roots; an unknown key is an error.

The project configuration guide lists every table with its keys and defaults.

## 4. Choose the optional layers from what the repository is

Every layer is a table; a missing table is off. Look before adding:

```sh
git rev-parse --git-common-dir   # a git checkout? then the git layer applies
git worktree list                # more than one line: linked worktrees already exist
git remote -v                    # the remote deliveries push to
```

| The repository                                                | Add                                                                                                                   | Why                                                                                                                               |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Agents run shell commands (always for Claude or Codex)        | `[hooks]` with `targets`, and the `[hooks.guards.shell.*]` and `[hooks.guards.git.*]` you want                        | Refuses heredocs, in-place `sed -i`, `git add -A`, `push --no-verify`, credential exfiltration. Each declared table is one guard. |
| A validator script per skill or package                       | `[hooks.checks.after_edit]` with `validator_glob` and a `command` containing `{validator}`                            | Reports a failing validator as context right after the edit.                                                                      |
| Committed generated files                                     | `[hooks.checks.on_stop]`                                                                                              | Reports projection drift at the end of a turn that edited.                                                                        |
| More than one agent at a time                                 | `[sessions.registry]`, `[sessions.pause]`, `[sessions.broadcast]`                                                     | The user can see, pause and message every session.                                                                                |
| A lockfile or other file two sessions must not change at once | `[sessions.leases.<name>]` with `path` and the `blocks` command prefixes                                              | A delivery touching that file holds the lease; the listed commands wait.                                                          |
| A git checkout                                                | nothing: `[git] enabled` is `"auto"`, and `[git.shared_checkout]` warns once the hooks exist                          | A session in the main checkout is warned while worktrees exist.                                                                   |
| Parallel agents in worktrees                                  | `[git.worktrees]`, `[git.worktrees.sync]`                                                                             | `pmcp git worktree create <alias>`; worktrees follow the mainline when that loses nothing.                                        |
| A protected mainline with a test gate                         | `[git.mainline]` with `branch`, `[git.mainline.gate]` with `command`, `[git.mainline.deliver]`, `[git.mainline.sync]` | `pmcp git deliver` replays, gates and pushes one delivery at a time; direct `git push` is refused.                                |
| Submodules                                                    | `[git.submodules]`                                                                                                    | Sync follows clean submodule pins.                                                                                                |
| You will debug hooks                                          | `[logging]` with `level`                                                                                              | `pmcp logs` reads the JSONL; redaction is on by default.                                                                          |
| A remote MCP server both Claude and Codex use                 | `auth = "pmcp"` on that `[mcp.<alias>]`, then `pmcp mcp login <alias>`                                                | One login shared by both tools; tokens never enter the project.                                                                   |
| A team plugin marketplace                                     | `[marketplaces.<name>]` with `source` and `plugins`                                                                   | Claude and Codex both enable the same plugins.                                                                                    |
| Claude Code with several sessions                             | `[ui.claude]` (needs `[sessions.registry]`)                                                                           | Session panes and a hold before editing another session's file.                                                                   |
| Claude should ask before reading secrets or running risky git | `[permissions.claude]` with `allow`, `ask`, `deny` lists of native rules such as `Read(.env)` or `Bash(git push:*)`   | pmcp owns only the entries it adds to `.claude/settings.json`; rules already there stay. Claude only.                             |

Keep Codex's limits in mind: Codex has no ask, so an ask becomes `[hooks] ask_fallback`
(`deny` by default); roles cannot apply there (no agent type); Stop notices arrive at the
next prompt; SessionEnd hooks get at most 3 seconds.

## 5. Project and check

```sh
pmcp project          # write; exits 1 if it would overwrite a file it did not write
pmcp project --check  # write nothing; exit 2 on drift, stale, undeclared or dead-glob outputs
pmcp doctor           # exit 1 on any failed check; prints the feature x runtime table
```

`pmcp project` writes the tools' native files, `.agents/pmcp-hooks/` when any hook layer is
declared, and `pmcp.lock`. Commit the lock with the outputs: `--check` reports a removed
source's outputs as stale only from the lock, and the hook refuses a `policy.json` whose hash
differs from it.

Only Claude gets the rules. For the other tools, add one pointer row per rule to
`AGENTS.md` (path and when to read it).

## 6. Trust the folder in each tool

Codex, Gemini CLI and Grok Build skip project assets silently until the folder is trusted;
skills, MCP servers, agents and hooks just do not appear. Each developer does this once per
tool, and again in Codex `/hooks` after a projection changes a hook entry:

| Tool        | Where trust is recorded                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------------------- |
| Codex       | `~/.codex/config.toml`: `[projects."<absolute path>"]` with `trust_level = "trusted"`; hooks are reviewed in `/hooks` |
| Gemini CLI  | `~/.gemini/trustedFolders.json`                                                                                       |
| Grok Build  | `~/.grok/trusted_folders.toml`                                                                                        |
| Antigravity | `trustedWorkspaces` in `~/.gemini/antigravity-cli/settings.json`                                                      |

`pmcp doctor` reports Codex and Grok trust directly. Run it after trusting, not before, or
its failures only restate the missing trust.

## Report

The files written, the layers chosen and why, the `pmcp project --check` exit code, the
`pmcp doctor` feature table, and which tools still need the trust or hook review step.

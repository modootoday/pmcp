---
name: headless-agents-ci-scaffold
description: Write a CI job that runs Claude Code, Gemini CLI, Codex, Grok Build and Antigravity headless against a project MCP server, giving each the permission setting it actually honours, asserting on the tool call rather than the exit code, and gating with pmcp project --check and pmcp doctor. Use when adding agent CLIs to CI, when a headless agent run skips an MCP tool call, or when a permission flag seems to do nothing. Not for interactive sessions or for writing the MCP server itself.
metadata:
  tier: open
  level: L3
  domain: agent-workflow
  install: optional
  keywords: "headless agent, CI, allowedTools, permission flags, MCP permissions, Codex sandbox, Grok, Antigravity, pmcp doctor"
  requires-bin: "pmcp"
  verified-runtimes: "claude-code"
---

# Headless agent CLIs in CI

Every agent CLI blocks an MCP tool call it was not told to allow, and each spells the
allowance differently. Several fail quietly: the model announces the call and the run ends
with exit 0. So a CI job needs the right setting per tool and an assertion that the call
happened.

The settings below were last measured with one headless MCP call per tool (Claude Code
2.1.289, Gemini CLI 0.38.2, Codex 0.131.0, Grok Build 1.0.46, Antigravity 1.2.16); OpenCode,
also a pmcp target, was not measured, so check its own permission settings before relying on
a headless run. Re-check after an upgrade; these flags move.

## Permission per tool

`<server>` is the MCP alias (the `[mcp.<alias>]` name), `<tool>` the tool name.

| Tool        | Command                                                                                        | What lets the call through                                                                                                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | `claude -p "<prompt>" --permission-mode default --allowedTools mcp__<server>__<tool>`          | the `--allowedTools` rule; without it the call is blocked under `default`                                                                                                                     |
| Gemini CLI  | `gemini -p "<prompt>" --allowed-mcp-server-names <server> --allowed-tools mcp_<server>_<tool>` | one `--allowed-tools` flag per tool (a bare tool name does not match; the array form swallowed the prompt); the folder must be trusted; the flag is deprecated in favour of the Policy Engine |
| Codex       | `codex exec "<prompt>"`                                                                        | nothing; `exec` allowed the call without a flag                                                                                                                                               |
| Grok Build  | `grok -p "<prompt>" --permission-mode default --allow <server>__<tool>`                        | `--allow <server>__<tool>`; the Claude-style `mcp__<server>__<tool>` matches nothing                                                                                                          |
| Antigravity | `agy -p "<prompt>"`                                                                            | a `permissions.allow` entry `mcp(<server>/<tool>)` in `~/.gemini/antigravity-cli/settings.json`; `mcp(<server>)` alone does not match, and an unlisted tool is auto-denied                    |

### Grok precedence traps

- Grok reads Claude Code's `~/.claude/settings.json`. A `defaultMode: auto` there approves
  MCP calls over Grok's own `--permission-mode default` and `--disallowed-tools`. Run Grok on
  a runner whose home has no such setting.
- `--permission-mode default` on the command line beats a config `permission_mode =
"always-approve"`, but `--disallowed-tools` does not. Do not rely on a deny rule to keep a
  tool from running; pin the mode by flag and allow only what the job needs.
- A blocked call in `-p` is silent: no error line, exit 0.

### Codex sandbox

Under `--sandbox workspace-write`, `.agents/` is protected like `.git`: a patch touching it
is refused whole, including its other files. If the job edits `.agents/`, list it under
`[sandbox_workspace_write] writable_roots` in `.codex/config.toml`, or per run:

```sh
codex exec -s workspace-write \
  -c 'sandbox_workspace_write.writable_roots=["<absolute repo path>/.agents"]' "<prompt>"
```

## Trust on the runner

Codex, Gemini and Grok skip project assets (skills, MCP servers, agents) in an untrusted
folder, without an error. On a fresh runner, record the checkout as trusted for each tool
before the run (Codex: `[projects."<absolute path>"] trust_level = "trusted"` in
`~/.codex/config.toml`; Gemini: `~/.gemini/trustedFolders.json`; Grok:
`~/.grok/trusted_folders.toml`; Antigravity: `trustedWorkspaces` in its settings file).

## Assert the call, not the exit code

Exit 0 proves nothing here. Either put a logging proxy in front of the MCP server and
assert it logged a `tools/call` for the tool, or have the prompt return a value only the
tool can supply and grep for it.

## Projection gate

```sh
pmcp project --check   # exit 2: generated files drifted, went stale or are undeclared
pmcp doctor            # exit 1 on any failed check
```

`pmcp doctor` skips a CLI that is not installed, except the Codex trust check, which reads
`~/.codex/config.toml` whenever `codex` is in `[targets]`. On a runner without Codex, either
write the trust entry or pass `--tool` for the tools present (`pmcp doctor --tool claude
--tool gemini`).

## Job skeleton

```sh
set -eu
pmcp project --check
pmcp doctor --tool claude --tool gemini --tool grok
out=$(claude -p "Call <tool> on <server> and print the first result name." \
  --permission-mode default --allowedTools mcp__<server>__<tool>)
printf '%s\n' "$out" | grep -q '<expected value>'
```

Repeat the last two lines per tool with its own setting from the table.

## Report

The job file, the per-tool settings used with the version each was checked on, how each run
asserts the call, and any tool left out and why.

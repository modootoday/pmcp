# Getting started

[Back to the overview](../README.md)

Reading installed skills needs no login or model. The local MCP server reads files already on
your disk; CLI commands manage additional skill packages.

## 1. Register the server

```json
{
  "mcpServers": {
    "pmcp": { "command": "npx", "args": ["-y", "@modootoday/pmcp"] }
  }
}
```

Hosts differ about which file that goes in, and two of them will write it for you from [the install page](https://pmcp.build/install/). Nothing has to be installed first: `npx -y` fetches the package when needed.

## 2. See what it can see

```sh
npx -y @modootoday/pmcp list
```

One row per skill: the name, as `<package>/<slug>`, and the one-line description that `skill_find` ranks. Do this before you ask an agent anything, because it answers the question the server cannot ask you back.

An empty catalog exits **1** rather than 0, and prints the roots it walked. That is usually one of two things: the working directory is not the project, or none of the installed packages ships a `SKILL.md` at all.

## 3. Ask in a sentence

`skill_find` takes an `intent`: what you are trying to do, written as a sentence. Lexical search works best when its vocabulary matches the descriptions. It returns names only, ranked, and never a body.

```text
> skill_find "a job ran twice because two workers took the same lock"
+ redis-toolkit/locks
  ranking lexical
> skill_call redis-toolkit/locks
  the body, once
```

A bare keyword ranks badly on purpose. Descriptions are written as symptoms, so a sentence shares vocabulary with one of them and a single noun matches many of them weakly and none of them strongly. When you want to browse rather than search, `skill_catalog` is the tool that filters.

## 4. Read exactly one

`skill_call` takes the name `skill_find` returned and gives back that skill's body. It loads the full instructions into context, which is the whole point of the split: looking is cheap, and reading is deliberate.

An unknown name comes back as an error naming the tool to call instead, rather than as an empty result that reads like an empty catalog.

## Where it looks

By default, the `node_modules` directories above the working directory. Two options change that, and both belong in the `args` array beside `pmcp`:

```sh
npx -y @modootoday/pmcp list --root ./node_modules
npx -y @modootoday/pmcp list --scope @acme/
```

`--scope` matches the start of the package name, so `@acme` also matches `@acmetools/thing`. Include the trailing slash when you mean the scope. Both options are repeatable.

When two roots hold the same package, the first one wins: a nested `node_modules` holds an older copy of something the outer root already resolved.

## If you want semantic ranking

```sh
npm install --save-dev @modootoday/pmcp @huggingface/transformers
npx --no-install @modootoday/pmcp models
```

Install both packages locally so the server can resolve the optional encoder. Configure the model in a project `pmcp.toml`:

```toml
[embedding]
enabled = true
model = "embeddinggemma-2"
dtype = "q4"
dimensions = 256
```

```sh
npx --no-install @modootoday/pmcp index --config ./pmcp.toml
npx --no-install @modootoday/pmcp serve --config ./pmcp.toml
```

The default encoder remains `e5-small`. Gemma presets also support `128`, `512`, and `768` dimensions. `pmcp models --json` lists encoder presets without loading model assets. Custom compatible ONNX encoders can use a model ID and an `[embedding.encoder]` configuration.

Indexing may download weights when explicitly requested. Serving uses the matching complete local index offline; missing assets or a stale index keep ranking lexical. A model change requires reindexing and a server restart. Use `--local-only` to forbid downloads and `--dry-run` to preview indexing without loading a model.

In the host's MCP configuration, run the locally installed `node_modules/@modootoday/pmcp/dist/cli.js` with Node and an absolute `--config` path. This avoids resolving the server from a separate npx cache without its optional peer. With semantic search enabled, intents can be written in Korean or another language the selected encoder supports.

The model runtime and weights add installation and loading costs. Skip this optional step when local lexical search meets your needs.

## Keep your native tools together

Use [one project configuration](project-configuration.md) for Claude Code, Codex, Gemini CLI, Grok Build, Antigravity and opencode. Import existing MCP entries before projecting settings; use `pmcp project --check` and `pmcp doctor` to inspect the result.

On Linux or macOS, run `pmcp` to [open a terminal workspace](terminal-workspace.md) around a native main and its workers; the [harness guide](terminal-harness.md) covers explicit groups. Login, folder trust and permission decisions stay in each runtime. An [optional local mailbox](mailbox.md) exchanges peer messages without granting execution authority.

## What to do next

- [Ship a skill of your own](https://pmcp.build/authoring/) — the paths, the frontmatter, and how to write a description that gets found
- [The command reference](commands.md) — flags and exit codes
- [Run several agents in one repository](sessions.md) — sessions, messages and delivery
- [Compatibility](compatibility.md) — what runs on your platform and runtime
- [The licence](https://pmcp.build/licence/) — what Elastic License 2.0 permits

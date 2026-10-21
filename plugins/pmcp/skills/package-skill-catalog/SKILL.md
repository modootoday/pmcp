---
name: package-skill-catalog
description: Find, check and load the right skill from a PMCP skill catalog instead of guessing, including version-appropriate instructions for installed public libraries, and install selected PMCP marketplace skills through a native runtime. Use when a task might have a dedicated skill, when the PMCP tools (skill_find, skill_catalog, skill_describe, skill_call, skill_read, skill_bundle) are available, or when a search for a skill came back empty.
metadata:
  tier: open
  level: L1
  domain: agent-workflow
  install: default
  keywords: skill search, skill catalog, skill router, library instructions
  verified-runtimes: claude-code
---

# Package skill catalog

A catalog server keeps hundreds of skills out of the session until one is
needed. Its value depends on the order you use it in: search before you read,
check before you load, and never invent a name. Prefer the project's installed
library version and preserve its package manager, configuration, build scripts
and native runtime permissions.

## The loop

1. **Search with the problem, not a keyword.** Call skill_find with one full
   English sentence that says what you are trying to do and for whom. Add
   filters only for facts you already know (for example tier or medium).
2. **On an empty result, look before concluding.** Call skill_catalog (paged)
   and scan the group names. An empty search means the wording missed, not that
   no skill exists. Rephrase once with the vocabulary you saw there.
3. **Check the top one to three candidates.** Call skill_describe for each and
   compare metadata.level, the requirements, compatibility, the output licence
   and whether approval is needed. Prefer the narrowest skill that covers the task.
4. **Load one.** Call skill_call with the exact name the server returned. The
   body is the instruction; follow it on your own host.
5. **Read extra files only when the body points at them.** Use skill_read with
   the path the body names, or skill_bundle when the complete selected skill is
   needed. Treat scripts as text to review, not to run, unless the body asks and
   the user agreed.

## Library instructions

Check the target major and verified version before following version-sensitive
API examples. Catalog availability is not proof that a particular version was
tested. Read only the relevant skill and its needed references.

Without MCP, use pmcp list to inspect local catalogs and pmcp available to match
the public catalog against installed npm dependencies. Public library instructions
remain free and do not require a PMCP account.

## Rules

- Use only names a tool returned. A guessed name wastes a call and can load the
  wrong skill.
- Load at most two skills for one task. If neither fits, say so and work
  without one rather than stacking partial matches.
- Say which skill you used and why, in one line, so the user can check the
  choice.
- A skill tagged paid runs on a remote service and may cost the user. Show the
  estimate it asks for and wait for confirmation before submitting work.
- Never paste secrets into a skill's inputs. Skills name the environment
  variables they need; the values stay in the user's environment.
- When native skills and MCP both expose the same instructions, use one source
  for the task rather than loading duplicate bodies.

## Install deliberately

PMCP 0.14.0 includes the marketplace export command and public default provider.
Older versions retain their previous install behavior; their users can install
free website archives or native plugins.

Choose one library major with the native plugin manager, or use pmcp marketplace
export to create a runtime-specific plugin directory. Installing a skill does not
install the target library. Preserve native installation consent and project trust.

Use pmcp install --dry-run before applying public npm skill installation with
--yes. Hosted catalog installation is a separate explicit provider. Do not copy
provider OAuth credentials into plugin manifests or PMCP configuration.

Avoid activating competing major versions under the same unnamespaced skill name.

## When to stop using the catalog

If the task is a one-line answer, or the user named the exact procedure, skip
the search. The catalog is for tasks where a tested procedure beats improvising.

## Boundaries and sources

Catalog MCP tools read local files. They do not install plugins, run target library
commands, download models or grant tool permissions. Native runtime authentication
and approval remain native.

See the public [installation guide](https://pmcp.build/install/) and
[skill catalog](https://pmcp.build/skills/). Skills follow
[Agent Skills](https://agentskills.io/specification); plugin packaging follows
[Agent Plugins](https://agent-plugins.org/) with native runtime adapters.

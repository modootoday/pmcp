---
name: package-skill-catalog
description: Find version-appropriate development instructions for installed public libraries, inspect a PMCP skill before using it, or install selected PMCP marketplace skills through a native runtime.
---

# Package skill catalog

Use PMCP when library instructions are available through its catalog or an installed
package. Prefer the project's installed library version and preserve its package
manager, configuration, build scripts and native runtime permissions.

## Find and inspect

When PMCP MCP tools are connected, use skill_find with the concrete development
task. Use skill_catalog for an inventory, skill_describe to inspect compatibility
and resources, and skill_call for the selected instructions. Use skill_read for a
referenced file and skill_bundle when the complete selected skill is needed.

Check the target major and verified version before following version-sensitive
API examples. Catalog availability is not proof that a particular version was
tested. Read only the relevant skill and its needed references.

Without MCP, use pmcp list to inspect local catalogs and pmcp available to match
the public catalog against installed npm dependencies. Public library instructions
remain free and do not require a PMCP account.

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
When native skills and MCP both expose the same instructions, use one source for
the task rather than loading duplicate bodies.

## Boundaries and sources

Catalog MCP tools read local files. They do not install plugins, run target library
commands, download models or grant tool permissions. Native runtime authentication
and approval remain native.

See the public [installation guide](https://pmcp.build/install/) and
[skill catalog](https://pmcp.build/skills/). Skills follow
[Agent Skills](https://agentskills.io/specification); plugin packaging follows
[Agent Plugins](https://agent-plugins.org/) with native runtime adapters.

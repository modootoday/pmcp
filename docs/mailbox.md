# Local mailbox

[Back to the overview](../README.md)

## Optional local mailbox

Mailbox is disabled by default. The six catalog tools stay read-only. A launcher
that supplies a private actor credential adds five tools: mailbox_send,
mailbox_inbox, mailbox_read, mailbox_ack, and mailbox_sessions. Read and ack
record durable receipts; peer text is data and does not authorize execution.

```sh
pmcp mailbox init --config ./pmcp.toml
pmcp mailbox actor --config ./pmcp.toml --actor reviewer --actor-file /private/reviewer.actor.json
pmcp serve --config ./pmcp.toml --mailbox-actor-file /private/reviewer.actor.json --mailbox-runtime codex-cli
```

Initialization preserves existing configuration and creates a project UUID.
State defaults to XDG_STATE_HOME/pmcp/projects/<project UUID>, outside the
repository. Credential and binding files contain secrets: keep them private,
outside source control and container images. Commands do not print credentials.
An optional mailbox-binding-file records the current attachment for a trusted
launcher. Replacement requires the exact mailbox-replace-session ID; stale
sessions are fenced. Canonical runtimes are codex-cli, claude-code, gemini-cli,
grok-cli, and antigravity; the Antigravity executable is agy.

The mailbox CLI also supports send, inbox, read, ack, sessions, rotate, export,
backup, and restore. Actor operations accept a private actor-file or existing
binding-file and JSON input file. Administration requires explicit operator
intent. Backups and exports are sensitive. Encrypted recovery bundles are
available through the mailbox API; key custody belongs to the operator.

```ts
import { MailboxService, MailboxStore } from "@modootoday/pmcp/mailbox";

const store = await MailboxStore.open({
  enabled: true,
  projectId,
  databasePath,
});
const credential = await store.registerActor("reviewer");
const binding = await store.attach(credential, "codex-cli");
const mailbox = new MailboxService(store, binding);
```

Pass mailbox to createSkillServer or registerMailboxTools on an existing server.
For HTTP, provide mailboxFor(caller) to createSkillHttpHandler; the host resolves
authenticated callers to authorized bindings. Tool arguments cannot choose a
sender identity. The host owns attachment heartbeat and cleanup. Child actors
have bounded authority and may reply only to their parent. Generation changes,
parent expiry, and credential rotation revoke stale child authority.

The public package contains one reusable local mailbox domain. Optional owned
terminal supervision and explicit input delivery are provided separately by the
[local CLI harness](terminal-harness.md); MCP mailbox tools cannot reach those
execution paths. Provider credentials and approvals remain with native runtimes.
Organization identity, fleet policy and enterprise audit retention belong to a
dedicated host. Existing arbitrary terminal sessions are not captured. Elastic
License 2.0 and NOTICE continue to apply.

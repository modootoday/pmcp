# Native terminal control

Use `pmcp harness` to manage a main runtime and its workers through a local CLI.
Each runtime keeps its own conversation interface, OAuth login, folder trust and
tool permissions. PMCP manages owned terminal processes, observations and
explicit input delivery. These controls are available from version 0.12.0;
check your installed release's `pmcp harness --help` before using them.

The host currently needs Linux, tmux, util-linux flock and a working user systemd
manager. Native executables must be on PATH. The terminal transport was tested
with tmux 3.2a and controlled executable fixtures. That does not qualify every
vendor's prompt state, automatic wake, authentication refresh or native children.

## Check the host

```sh
pmcp harness capabilities inspect
pmcp harness doctor inspect
```

These commands report executable paths and required tools without starting a
provider or reading its credentials. An installed executable is not a qualified
provider feature. Use `pmcp doctor` separately for project configuration checks.

Group creation checks required tools and contacts the user manager before it
writes group state. Missing tools return native_host_tool_unavailable followed
by the tool name; an unreachable manager returns native_user_manager_unavailable.
The doctor report lists prerequisites and does not certify cgroup delegation.
An ordinary isolated Docker container usually lacks this user manager and a
writable delegated cgroup subtree. Container resource limits alone do not
qualify the native session controls; the current profile requires its Linux host.

## Choose native or Docker execution

The default native profile starts executables on the Linux host. The optional
Docker profile keeps the same host-side tmux and user-systemd controller, while
each native executable runs in its own bounded container. Docker does not
replace the host prerequisites above. Only a local Docker Engine is supported.

Prepare an image locally with your runtime installed. PMCP requires its exact
image ID, refuses a missing image and never builds or pulls one. The image must
support the host UID/GID and the absolute command paths in your policy.
Create `docker-policy.json` with this structure, replacing the image ID:

```json
{
  "schemaVersion": 1,
  "image": "sha256:YOUR_64_CHARACTER_IMAGE_ID",
  "network": "none",
  "workspaceAccess": "read-only",
  "commands": {
    "codex-cli": ["/usr/local/bin/codex"]
  }
}
```

Set `profile` to `docker` and `dockerPolicyFile` to the policy's absolute path in
your group specification. The policy is validated and frozen into group state;
editing its file does not expand a running group's authority. Group creation and
session start use the same commands as native execution.

Each container gets a read-only root, no network, all capabilities dropped,
no-new-privileges, 64 PIDs and a memory/swap ceiling. Its only bind mounts are
the project at `/workspace` and a private writable profile at `/state`.
The workspace is read-only unless the policy explicitly selects read-write.
Native arguments belong in the session specification; PMCP adds no native
permission bypass. Docker access itself is a privileged host capability.

The session `memoryMb` reserves both runtime memory and 64 MiB for its host
connection. Its Docker memory limit is therefore 64 MiB smaller. Leave additional
headroom in the group budget for its controller and tmux server.
Session receipts include the owned container identity only for Docker execution.
Unknown or changed container identity blocks cleanup and admission.

### Allow provider connections explicitly

Network-none containers are offline by default. To allow provider HTTPS, add an
`egress` entry to the policy:

```json
{
  "hosts": ["chatgpt.com", "auth.openai.com"],
  "bridgeExecutable": "/usr/local/bin/node"
}
```

These are exact hostnames on port 443, not domain suffixes or wildcards. The
host proxy rejects private addresses and undeclared destinations. The declared
Node executable must exist inside the image. PMCP stages a digest-checked opaque
bridge and provides proxy environment variables to the native process. It does
not intercept TLS or interpret OAuth. A runtime that ignores proxy variables
cannot reach the provider through this profile. Actual Codex 0.161.0 login and
main/worker responses have been qualified; other vendors and token refresh need
their own validation. These two hosts are an observed test scope, not a promise
that all future Codex features use only them.

### Keep authenticated roles independent

Omitting `privateProfiles` creates a new empty profile for each launch. For
explicit reuse, prepare distinct local directories owned by your UID with mode
0700, outside the project and credential home. Add named grants to the policy:

```json
{
  "main": {
    "runtime": "codex-cli",
    "directory": "/absolute/private/main-profile",
    "lockExecutable": "/usr/bin/flock"
  },
  "worker": {
    "runtime": "codex-cli",
    "directory": "/absolute/private/worker-profile",
    "lockExecutable": "/usr/bin/flock"
  }
}
```

Place this object under `privateProfiles`. Select `privateProfile: "main"` or
`privateProfile: "worker"` in the corresponding session specification. PMCP
checks and freezes directory/lock identity; the selected runtime must match its
grant. The image must provide the declared flock executable.

Authenticate each role with its vendor's native login in that role's isolated
profile. PMCP supplies no credential import or account-switching command.
Do not copy your host credentials or clone one role's profile into another.
Never place profiles or mailbox actor files below the mounted project. An
exclusive kernel lock stays held by the container while its runtime lives,
even if the host terminal connection exits. Stop the exact owned session before
reusing its profile. This lock is cooperative same-UID fencing, not protection
against a hostile host administrator.

Keep private profiles when you stop a group if you intend to reuse their native
login. Session termination does not log out the account or delete credentials.
Do not publish these directories or add them to source control.

## Create a group and its sessions

Save this as `group-spec.json`, replacing the project path:

```json
{
  "projectRoot": "/absolute/project/path",
  "allowedRuntimes": ["codex-cli", "claude-code"],
  "memoryMb": 2048,
  "maxActive": 2
}
```

```sh
pmcp harness group create --input group-spec.json
pmcp harness group list
```

The JSON receipt provides the private groupFile and generation. Set GROUP_FILE
and GENERATION to those values for the examples below. Group state lives below
XDG_STATE_HOME/pmcp/harness, or ~/.local/state/pmcp/harness. The tmux socket path
must fit within 100 bytes; an unusually long state root is refused.

Save `main-spec.json`:

```json
{
  "runtime": "codex-cli",
  "role": "main",
  "memoryMb": 768
}
```

```sh
pmcp harness session start --group-file "$GROUP_FILE" --generation "$GENERATION" --input main-spec.json
pmcp harness session list --group-file "$GROUP_FILE"
```

Start a worker with another specification whose role is worker. Supported
runtime IDs are codex-cli, claude-code, gemini-cli, grok-cli and antigravity;
their executable names are codex, claude, gemini, grok and agy. Optional args
contains native CLI arguments. PMCP adds no permission bypass flags.
Start resolves the executable against the native working directory before
creating a launch record. A missing or non-executable program is refused as
runtime_executable_unavailable; directories are not accepted as executables.

A group has one main. Workers require an available main, a runtime grant and
room in both the session-count and memory budgets. cwd defaults to projectRoot
and must resolve inside it. This working-directory check and cooperative writer
leases do not isolate filesystem access from another process of the same UID.

Native execution waits behind a start gate until its owned terminal record and
group registration are saved. The gate checks the group generation, runtime
grant and role before starting the executable. A failed or interrupted start
blocks further admission until you explicitly resolve it.

## Observe or take control

Set SESSION to a session ID from the receipt:

```sh
pmcp harness session inspect --group-file "$GROUP_FILE" --session "$SESSION"
pmcp harness session read --group-file "$GROUP_FILE" --session "$SESSION"
pmcp harness attach open --group-file "$GROUP_FILE" --session "$SESSION"
```

Attachment is read-only by default. Detach with tmux's Ctrl-b then d, or use
attach detach with the target session and current generation. Detach preserves
the runtime. Reading returns terminal text and does not infer model readiness.

For longer history, save read-options.json:

```json
{ "lines": 2000, "maxBytes": 16384 }
```

```sh
pmcp harness session read --group-file "$GROUP_FILE" --session "$SESSION" --input read-options.json
```

lines accepts 1–2000 and maxBytes accepts 1–65536. Defaults remain 100 lines and
16384 bytes. A bounded result reports truncated when it omits earlier content.
During an alternate-screen application, alternate: true reads the saved normal
screen; omitted or false reads the current screen. This returns the owned native
pane's content, separate from a surrounding terminal's older shell output.

On the tested tmux 3.2a, read-only native clients ignore typing, wheel reports
and copy-mode keys; use session read for history without acquiring control.
Inside another tmux with the same Ctrl-b prefix, Ctrl-b then Ctrl-b forwards
one prefix to the inner layer. Ctrl-b then [ opens the outer copy mode, while
Ctrl-b, Ctrl-b, d detaches the inner connection. Outer history is the rendered
wrapper screen; session read retrieves the owned runtime's history.
PMCP does not change the outer tmux configuration. Other terminal mouse and
trackpad settings require their own qualification.

For bounded polling, session watch also takes an input file containing count
(1–10) and intervalMs (100–2000). It returns snapshots rather than an endless
stream.

Acquire native control before opening a writable attachment:

```sh
pmcp harness control acquire --group-file "$GROUP_FILE" --generation "$GENERATION" --session "$SESSION" --controller operator --mode native
pmcp harness attach open --group-file "$GROUP_FILE" --generation "$GENERATION" --session "$SESSION" --mode write --lease-file "$LEASE_FILE"
```

Set LEASE_FILE to the acquire receipt's private credential path. A writable
attachment renews its 60-second lease and releases it after detach. Failed
renewal disconnects the client. It does not stop the runtime. Another writable
tmux client blocks CLI delivery even if it bypassed PMCP's lease.

## Deliver input explicitly

Use mode cli when acquiring a lease for explicit command-line input.
Save literal single-line UTF-8 text in prompt.txt:

```sh
pmcp harness input write --group-file "$GROUP_FILE" --generation "$GENERATION" --lease-file "$LEASE_FILE" --request-id task1-attempt1-draft --text-file prompt.txt
pmcp harness input submit --group-file "$GROUP_FILE" --generation "$GENERATION" --lease-file "$LEASE_FILE" --request-id task1-attempt1-submit
pmcp harness control release --group-file "$GROUP_FILE" --generation "$GENERATION" --lease-file "$LEASE_FILE"
```

Write and Enter submission are separate operations. Newlines, tabs, terminal
control characters and input above 16 KiB are refused. A tmux paste flag alone
cannot guarantee safe multiline delivery in a native approval menu.

Inspect the native screen before writing or submitting. A control lease identifies
the writer; it does not identify the active native widget. PMCP does not infer
that a composer is ready or that a native approval has been granted.

Reuse an input request ID only for an exact retry. Matching retries return the
previous receipt; they do not send again. Conflicting content is refused.
input_written means terminal delivery, not model processing or task completion.
Intent or uncertain delivery requires recovery and is never automatically
replayed. delivery list and delivery inspect expose this journal.

An uncertain receipt has ok: false and CLI exit code 1, including an exact
retry that returns the stored receipt. Inspect its state instead of assuming
that a nonzero exit means no record exists. An exited worker remains observable;
stop it by ID and explicitly start a replacement. Old request IDs are not
transferred to the replacement, and sibling sessions retain their input.

Input interrupt sends an explicit terminal Ctrl-c under the same lease.
Cancellation, process termination and provider-side completion are distinct.

## Coordinate through the existing mailbox

Use the existing `pmcp mailbox` commands for send, inbox, read and ack.
Keep task and attempt IDs in your message body; send a result with replyToId
pointing to its request. Main review reads the reply. Acknowledgment records
receipt handling and does not declare task completion or user acceptance.

PMCP does not create another message engine or automatically type a wake prompt
into a native menu. Follow the [mailbox guide](mailbox.md) for actor credentials
and launcher-bound runtime attachments.
There is no automatic delivery loop. Native readiness and approval stay with
the operator and runtime; an input receipt does not establish prompt readiness.

### A manual request and review workflow

Mailbox actor names and harness session roles are separate. Creating a main or
worker terminal does not register a mailbox actor or give it credentials. Use
the mailbox guide to initialize the project and register main, worker and
operator actors. Keep their credential files private. The following workflow
uses CLI actor files for manual coordination; it does not attach a vendor child
or automatically configure a runtime's MCP server.

Save request.json with your actor name and a unique task/attempt pair:

```json
{
  "recipients": [{ "actorId": "worker" }],
  "body": "{\"taskId\":\"review-1\",\"attemptId\":\"attempt-1\",\"kind\":\"request\",\"text\":\"Review the proposed change\"}",
  "idempotencyKey": "review-1-attempt-1"
}
```

```sh
pmcp mailbox send --config ./pmcp.toml --actor-file "$MAIN_ACTOR_FILE" --input request.json
pmcp mailbox inbox --config ./pmcp.toml --actor-file "$WORKER_ACTOR_FILE"
```

The send receipt returns messageId and threadId. Save the returned messageId
in message.json as {"messageId":"the-returned-UUID"}, then read and acknowledge:

```sh
pmcp mailbox read --config ./pmcp.toml --actor-file "$WORKER_ACTOR_FILE" --input message.json
pmcp mailbox ack --config ./pmcp.toml --actor-file "$WORKER_ACTOR_FILE" --input message.json
```

Receiving and acknowledging a request sends no terminal input. When its native
prompt is ready, deliver a single-line prompt through the worker's CLI lease
and submit separately. Include the task/attempt and request message ID so the
worker can associate its response. Preserve uncertain delivery for inspection.

To report a result, use mailbox send with the same taskId and attemptId in body,
a new idempotencyKey, recipients containing main, and replyToId containing the
original request messageId. The worker must first read that request. The result
keeps its threadId; the main can filter inbox with an input file containing
{"threadId":"the-returned-thread-UUID"} and read the selected reply.

Read the body and verify its task, attempt and sender before accepting the
result. These body fields are a coordination convention, not a mailbox-enforced
task state machine. A new attempt uses a new request and idempotency key; keep
the previous result in its original thread. Exact send retries reuse their key
and return the existing message; changed payloads are refused.

The main can send its synthesis to operator as a reply to the reviewed result.
After reading it, the operator may send a separate acceptance reply. ACK records
receipt handling only. Neither result text, ACK nor acceptance automatically
submits a terminal draft, transfers control or executes a command.

## Pause, stop and recover

group pause prevents new sessions without interrupting running providers.
group resume permits admission again. group configure takes a JSON input to
adjust budgets or narrow runtime grants; it refuses reductions below active
reservations. Expanding grants requires a new group.

session stop names one owned session. group stop explicitly stops its entire
owned group and removes runtime budget properties. Both require the current
generation. They do not target an existing external tmux session.

recovery inspect reports observations, leases, uncertain deliveries and
unregistered owned sessions. recovery reconcile removes a writer lock only
after its controller has exited and never resends input. Use recovery
stop-orphan for a named unregistered session, or recovery replace-main with a
new main specification after the previous main has stopped. Replacement changes
the generation and invalidates old control credentials. Unknown server or pane
identity fails closed; no session is silently adopted.

Include pending starts explicitly when inspecting a failed launch:

```sh
pmcp harness recovery inspect --group-file "$GROUP_FILE" --include-starts
pmcp harness recovery abort-start --group-file "$GROUP_FILE" --generation "$GENERATION" --session "$SESSION"
```

abort-start stops a named incomplete launch and marks any saved group reference
as stopped. It neither adopts the session nor restarts it. A committed session
uses session stop instead. If the start gate died before recording ownership,
automatic cleanup is refused and admission remains blocked for administrative
repair. Keep the private state directory as evidence; do not guess a pane target
or resend an uncertain request.

## Layout planning

```sh
pmcp harness layout --columns 120 --rows 40
```

This pure command needs no tmux, provider, project or network. It returns layout
A at 120 columns and 32 rows or larger: a main pane, worker dock and bottom
coordination pane. Smaller terminals retain a full-width main. The minimum is
40 columns by 12 rows; the maximum is 1000 in either dimension.

Use the [terminal workspace](terminal-workspace.md) to render this layout over
an existing owned group. All control operations remain available through the CLI.

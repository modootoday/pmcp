// The harness family operations as data, so help and parsing read one table.

const common = ["group-file", "generation"];

export interface HarnessOperation {
  readonly describe: string;
  readonly options: readonly string[];
}

export const HARNESS_OPERATIONS: Readonly<Record<string, HarnessOperation>> = {
  "capabilities:inspect": {
    describe: "Report what this host can run",
    options: [],
  },
  "doctor:inspect": { describe: "Check host prerequisites", options: [] },
  "group:create": {
    describe: "Create an owned session group from --input",
    options: ["input"],
  },
  "group:list": { describe: "List owned groups", options: [] },
  "group:inspect": {
    describe: "Show one group",
    options: ["group-file"],
  },
  "group:configure": {
    describe: "Change a group's settings from --input",
    options: [...common, "input"],
  },
  "group:pause": {
    describe: "Pause every session of a group",
    options: common,
  },
  "group:resume": { describe: "Resume a paused group", options: common },
  "group:stop": { describe: "Stop a group and its sessions", options: common },
  "session:start": {
    describe: "Start a main or worker session from --input",
    options: [...common, "input"],
  },
  "session:list": {
    describe: "List a group's sessions",
    options: ["group-file"],
  },
  "session:inspect": {
    describe: "Show one session",
    options: ["group-file", "session"],
  },
  "session:read": {
    describe: "Read a session's recent output",
    options: ["group-file", "session", "input"],
  },
  "session:watch": {
    describe: "Follow a session's output",
    options: ["group-file", "session", "input"],
  },
  "session:stop": {
    describe: "Stop one session",
    options: [...common, "session"],
  },
  "control:acquire": {
    describe: "Take the input lease of a session",
    options: [...common, "session", "controller", "mode"],
  },
  "control:renew": {
    describe: "Renew a held input lease",
    options: [...common, "lease-file"],
  },
  "control:release": {
    describe: "Give the input lease back",
    options: [...common, "lease-file"],
  },
  "input:write": {
    describe: "Type text into a session without submitting it",
    options: [...common, "lease-file", "request-id", "text-file"],
  },
  "input:submit": {
    describe: "Submit what was written",
    options: [...common, "lease-file", "request-id"],
  },
  "input:interrupt": {
    describe: "Interrupt the session's current turn",
    options: [...common, "lease-file"],
  },
  "attach:open": {
    describe: "Attach a terminal to a session, read only unless --mode write",
    options: [...common, "session", "mode", "lease-file"],
  },
  "attach:inspect": {
    describe: "Show a session's attachments",
    options: ["group-file", "session"],
  },
  "attach:detach": {
    describe: "Detach from a session",
    options: [...common, "session"],
  },
  "delivery:list": {
    describe: "List input deliveries",
    options: ["group-file"],
  },
  "delivery:inspect": {
    describe: "Show one input delivery",
    options: ["group-file", "request-id"],
  },
  "recovery:inspect": {
    describe: "Find sessions and starts that need recovery",
    options: ["group-file", "include-starts"],
  },
  "recovery:reconcile": {
    describe: "Reconcile recorded state with live processes",
    options: common,
  },
  "recovery:replace-main": {
    describe: "Replace a lost main session from --input",
    options: [...common, "input"],
  },
  "recovery:stop-orphan": {
    describe: "Stop a session no group owns",
    options: [...common, "session"],
  },
  "recovery:abort-start": {
    describe: "Abort a session start that never finished",
    options: [...common, "session"],
  },
};

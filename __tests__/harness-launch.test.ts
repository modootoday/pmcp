import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { GroupStore, privateJson } from "../src/harness/groups/store.js";
import {
  RecordStore,
  budgetSlice,
  runtimeUnit,
} from "../src/harness/adapters/tmux/records.js";
import {
  LaunchJournal,
  pendingLaunches,
} from "../src/harness/launch/journal.js";
import { runOperation } from "../src/harness/application/dispatch.js";
import { harnessOptions } from "../src/commands/harness/options.js";
import { parseInvocation } from "../src/commands/harness/invocation.js";
import { runLayout } from "../src/commands/harness/layout.js";
import { parseArgs } from "../src/cli/command.js";
import { Ui } from "../src/cli/ui.js";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "pmcp-launch-"));
  const owner = randomUUID();
  mkdirSync(join(directory, "sessions"), { mode: 0o700 });
  privateJson(join(directory, "harness.json"), { owner });
  const records = new RecordStore(directory);
  const id = randomUUID();
  const journal = new LaunchJournal(records, id);
  const group = {
    schemaVersion: 1,
    owner,
    id: randomUUID(),
    generation: randomUUID(),
    projectRoot: directory,
    allowedRuntimes: ["codex-cli"],
    profile: "native",
    state: "ready",
    memoryMb: 512,
    maxActive: 1,
    sessions: [],
  };
  const groupFile = join(directory, "group.json");
  privateJson(groupFile, { group, leases: [], deliveries: [] });
  const nonce = randomUUID();
  const createdAt = new Date().toISOString();
  privateJson(journal.path("intent"), {
    id,
    owner,
    controllerIdentity: `${process.pid}:1`,
    groupId: group.id,
    generation: group.generation,
    role: "main",
    nonce,
    unit: runtimeUnit(id),
    slice: budgetSlice(owner),
    socket: records.socket,
    runtime: "codex-cli",
    memoryMb: 64,
    argv: ["codex"],
    cwd: directory,
    createdAt,
  });
  const session = {
    id,
    owner,
    runtime: "codex-cli",
    socket: records.socket,
    tmuxSessionId: "$0",
    windowId: "@0",
    paneId: "%0",
    panePid: 123,
    serverIdentity: "123:456",
    unit: runtimeUnit(id),
    memoryMb: 64,
    cwd: directory,
    createdAt,
  };
  privateJson(journal.path("proof"), {
    session,
    nonce,
    runnerIdentity: "123:456",
  });
  return {
    directory,
    records,
    journal,
    session,
    groupFile,
    store: new GroupStore(groupFile),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

it("requires actual persisted group registration before granting native execution", () => {
  const f = fixture();
  try {
    expect(() => f.journal.authorize()).toThrow("launch_registration_missing");
    f.records.save(f.session);
    expect(() => f.journal.authorize()).toThrow("launch_registration_missing");
    expect(existsSync(f.journal.path("grant"))).toBe(false);
    f.store.state.group.sessions.push({
      id: f.session.id,
      role: "main",
      stopped: false,
    });
    expect(() => f.journal.authorize()).toThrow("launch_registration_missing");
    f.store.save();
    f.journal.authorize();
    f.journal.commit();
    expect(pendingLaunches(f.records)).toEqual([]);
  } finally {
    f.cleanup();
  }
});

it("refuses a changed generation and a mismatched launch proof before granting", () => {
  const f = fixture();
  try {
    f.store.state.group.generation = randomUUID();
    f.store.save();
    expect(() => f.journal.authorize()).toThrow(
      "launch_group_generation_mismatch",
    );
    const proof = f.journal.proof();
    privateJson(f.journal.path("proof"), { ...proof, nonce: randomUUID() });
    expect(() => f.journal.grant()).toThrow("foreign_launch_proof");
    expect(existsSync(f.journal.path("grant"))).toBe(false);
  } finally {
    f.cleanup();
  }
});

it("keeps completed launch history separate from the group's later generation", () => {
  const f = fixture();
  try {
    f.records.save(f.session);
    f.store.state.group.sessions.push({
      id: f.session.id,
      role: "main",
      stopped: false,
    });
    f.store.save();
    f.journal.authorize();
    f.journal.commit();
    f.store.state.group.generation = randomUUID();
    f.store.state.group.state = "stopped";
    f.store.state.group.sessions[0]!.stopped = true;
    f.store.save();
    f.records.save({ ...f.session, stoppedAt: new Date().toISOString() });
    expect(pendingLaunches(f.records)).toEqual([]);
    expect(() => f.journal.authorize()).toThrow(
      "launch_group_generation_mismatch",
    );
  } finally {
    f.cleanup();
  }
});

it("requires explicit include-starts input before extending recovery output", async () => {
  const f = fixture();
  try {
    const operation = {
      family: "recovery",
      action: "inspect",
      groupFile: f.groupFile,
    };
    expect(await runOperation(operation)).not.toHaveProperty("pendingStarts");
    const included = await runOperation({ ...operation, includeStarts: true });
    expect(included.pendingStarts).toEqual([
      expect.objectContaining({
        sessionId: f.session.id,
        proofPresent: true,
        recordPresent: false,
        registered: false,
      }),
    ]);
    expect(existsSync(f.journal.path("grant"))).toBe(false);
  } finally {
    f.cleanup();
  }
});

it("rejects a recovery-only flag in other command families and layout", () => {
  const context = (argv: string[]) => ({
    args: parseArgs(argv, harnessOptions),
    ui: new Ui(),
    cwd: "/project",
    env: {},
  });
  const original = ["recovery", "inspect", "--group-file", "/state/group.json"];
  expect(parseInvocation(context(original))).not.toHaveProperty(
    "includeStarts",
  );
  expect(
    parseInvocation(context([...original, "--include-starts"])).includeStarts,
  ).toBe(true);
  expect(() =>
    parseInvocation(
      context([
        "group",
        "inspect",
        "--group-file",
        "/state/group.json",
        "--include-starts",
      ]),
    ),
  ).toThrow("not supported");
  expect(() =>
    runLayout(
      context([
        "layout",
        "--columns",
        "120",
        "--rows",
        "40",
        "--include-starts",
      ]),
    ),
  ).toThrow("not supported");
});

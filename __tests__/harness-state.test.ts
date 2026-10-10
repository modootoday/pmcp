import { randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readPrivateJson } from "../src/harness/groups/store.js";
import { validateState } from "../src/harness/groups/validation.js";
import { validateText } from "../src/harness/adapters/tmux/input.js";

function state() {
  return {
    group: {
      schemaVersion: 1,
      owner: randomUUID(),
      id: randomUUID(),
      generation: randomUUID(),
      projectRoot: "/project",
      allowedRuntimes: ["claude-code"],
      profile: "native",
      state: "ready",
      memoryMb: 512,
      maxActive: 2,
      sessions: [{ id: randomUUID(), role: "main", stopped: false }],
    },
    leases: [] as Record<string, unknown>[],
    deliveries: [],
  };
}

it("refuses an invalid expiry before treating a writer as available", () => {
  const value = state();
  value.leases.push({
    token: randomUUID(),
    sessionId: value.group.sessions[0]!.id,
    generation: value.group.generation,
    controller: "test",
    mode: "cli",
    expiresAt: "invalid",
  });
  expect(() => validateState(value)).toThrow("invalid_control_expiry");
});

it("refuses duplicate writer credentials and multiple live mains", () => {
  const value = state();
  value.group.sessions.push({ ...value.group.sessions[0]!, id: randomUUID() });
  expect(() => validateState(value)).toThrow("multiple_active_main_sessions");
  value.group.sessions.pop();
  const lease = {
    token: randomUUID(),
    sessionId: value.group.sessions[0]!.id,
    generation: value.group.generation,
    controller: "test",
    mode: "cli",
    expiresAt: new Date().toISOString(),
  };
  value.leases.push(lease, { ...lease, token: randomUUID() });
  expect(() => validateState(value)).toThrow("duplicate_state_identity");
});

it("refuses symlinks and publicly readable private state", () => {
  const directory = mkdtempSync(join(tmpdir(), "pmcp-harness-state-"));
  const path = join(directory, "state.json");
  try {
    writeFileSync(path, "{}", { mode: 0o600 });
    expect(readPrivateJson(path)).toEqual({});
    const link = join(directory, "alias.json");
    symlinkSync(path, link);
    expect(() => readPrivateJson(link)).toThrow();
    chmodSync(path, 0o644);
    expect(() => readPrivateJson(path)).toThrow("unsafe_state_file");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it.each(["a\nb", "a\rb", "a\tb", "\x1b[200~", "a".repeat(16_385)])(
  "refuses unqualified terminal control input",
  (text) => expect(() => validateText(text)).toThrow(),
);

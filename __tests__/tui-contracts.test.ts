import { expect, it } from "vitest";
import { parseArgs, ArgumentError } from "../src/cli/command.js";
import { parseTui, tuiOptions } from "../src/commands/tui/invocation.js";
import {
  describeFailure,
  phaseLabel,
} from "../src/tui/application/feedback.js";
import { freshSnapshot } from "../src/tui/presentation/observation.js";
import { coordinationLines } from "../src/tui/presentation/summary.js";
import type { View, Snapshot } from "../src/tui/contracts.js";
import { isReadOnly } from "../src/harness/application/effects.js";

it("rejects irrelevant and incomplete TUI options before effects", () => {
  for (const argv of [
    ["control", "--view", "view.json", "--index", "2"],
    ["stop", "--view", "view.json"],
    ["resize", "--view", "view.json", "--columns", "160"],
    ["create", "--group-file", "group.json", "--config", "pmcp.toml"],
    ["observe", "--view", "view.json", "--index", "1.2"],
  ])
    expect(() => parseTui(parseArgs(argv, tuiOptions))).toThrow(ArgumentError);
});

it("exposes lifecycle and navigation independently of a terminal renderer", () => {
  expect(
    parseTui(
      parseArgs(
        ["stop", "--view", "view.json", "--confirm-session", "exact-id"],
        tuiOptions,
      ),
    ),
  ).toMatchObject({ action: "stop", input: { confirmSession: "exact-id" } });
  expect(parseTui(parseArgs(["doctor"], tuiOptions))).toEqual({
    action: "doctor",
    input: {},
  });
  expect(isReadOnly({ family: "attach", action: "inspect" })).toBe(true);
});

it("does not render a granted lease as a ready writer", () => {
  expect(phaseLabel("acquiring")).toBe("REQUESTING CONTROL");
  expect(phaseLabel("connecting")).toBe("CONNECTING WRITER");
  expect(phaseLabel("controlled")).toBe("CONTROL READY");
  expect(phaseLabel("uncertain")).toContain("INPUT BLOCKED");
});

it("retains actionable errors even when observations are stale", () => {
  const failure = describeFailure("control", new Error("native_writer_active"));
  const view = {
    target: "worker-id",
    mainId: "main-id",
    phase: "read-only",
    failure,
  } as View;
  const lines = coordinationLines(undefined, view);
  expect(lines).toHaveLength(4);
  expect(lines.join("\n")).toContain("native_writer_active");
  expect(lines.join("\n")).toContain("Detach that writer");
  expect(failure.inputReplayed).toBe(false);
});

it("redacts arbitrary errors instead of persisting process output or credentials", () => {
  expect(
    describeFailure("control", new Error("secret=token\nraw transcript")),
  ).toMatchObject({ code: "view_action_failed", inputReplayed: false });
  expect(
    JSON.stringify(describeFailure("control", new Error("secret=token"))),
  ).not.toContain("token");
});

it("rejects future and stale snapshots", () => {
  const snapshot = {} as Snapshot;
  expect(
    freshSnapshot({ observedAt: new Date(1000).toISOString(), snapshot }, 2000),
  ).toBe(snapshot);
  expect(() =>
    freshSnapshot({ observedAt: new Date(1000).toISOString(), snapshot }, 7000),
  ).toThrow("stale_observation");
  expect(() =>
    freshSnapshot({ observedAt: new Date(7000).toISOString(), snapshot }, 2000),
  ).toThrow("stale_observation");
});

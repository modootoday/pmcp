import { afterEach, expect, it, vi } from "vitest";
import { inspectTerminalHost } from "../src/tui/startup/diagnostics.js";

const mocks = vi.hoisted(() => ({ assertHost: vi.fn() }));
vi.mock("../src/harness/adapters/systemd/admission.js", () => ({
  assertNativeHost: mocks.assertHost,
}));
vi.mock("../src/tui/adapters/process/runtime.js", () => ({
  dependencies: () => ({
    supported: true,
    platform: "linux",
    tmux: "/fixture/tmux",
    flock: "/fixture/flock",
    systemctl: "/fixture/systemctl",
    systemdRun: "/fixture/systemd-run",
    nodeSupported: true,
  }),
}));
vi.mock("../src/harness/adapters/process/executable.js", () => ({
  locateExecutable: (name: string) =>
    name === "codex" ? "/fixture/codex" : undefined,
}));
afterEach(() => vi.resetAllMocks());

it("does not certify support when installed tools cannot reach the user manager", () => {
  mocks.assertHost.mockImplementation(() => {
    throw new Error("native_user_manager_unavailable");
  });
  expect(inspectTerminalHost()).toMatchObject({
    supported: false,
    userManagerAvailable: false,
    reason: "native_user_manager_unavailable",
    providerInvoked: false,
  });
  expect(inspectTerminalHost().remediation).toEqual([
    expect.stringContaining("systemctl --user status"),
  ]);
});

it("distinguishes executable discovery from native acceptance and authentication", () => {
  const receipt = inspectTerminalHost();
  expect(receipt.supported).toBe(true);
  expect(receipt.authenticationInspected).toBe(false);
  expect(receipt.runtimes).toContainEqual({
    id: "codex-cli",
    executable: "codex",
    path: "/fixture/codex",
    installed: true,
    nativeAcceptance: "not-assessed",
    authentication: "not-inspected",
  });
});

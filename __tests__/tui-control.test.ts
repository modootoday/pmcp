import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { acquireControl } from "../src/tui/application/control.js";
import type { ViewContext } from "../src/tui/application/context.js";
import type { Receipt } from "../src/harness/contracts.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function context(call: (family: string, action: string) => Promise<Receipt>) {
  const directory = mkdtempSync(join(tmpdir(), "pmcp-tui-control-"));
  directories.push(directory);
  const phases: string[] = [];
  const events: string[] = [];
  const input = vi.fn((pane: string, enabled: boolean) => {
    events.push(`input:${enabled}`);
  });
  const value = {
    file: join(directory, "view.json"),
    view: {
      owner: "test-owner",
      target: "main-id",
      mainId: "main-id",
      mainPane: "%0",
      phase: "read-only",
    },
    renderer: {
      input,
      replace: vi.fn(),
      attachment: () => ["fixture"],
      tty: () => "/dev/pts/123",
      select: vi.fn(),
      status: (view: { phase: string }) => {
        phases.push(view.phase);
        events.push(view.phase);
      },
    },
    common: { call },
    input: {},
  } as unknown as ViewContext;
  return { value, phases, input, events };
}

it("keeps input disabled until the exact native writer TTY is observed", async () => {
  let ready: (receipt: Receipt) => void = () => {};
  const observation = new Promise<Receipt>((resolve) => {
    ready = resolve;
  });
  const test = context(async (family) => {
    if (family === "control") return { leaseFile: "lease.json" };
    return observation;
  });
  const acquiring = acquireControl(test.value);
  await new Promise((resolve) => setImmediate(resolve));
  expect(test.value.view.phase).toBe("connecting");
  expect(test.input.mock.calls.every((call) => call[1] === false)).toBe(true);
  ready({ clients: [{ pid: 123, tty: "/dev/pts/123", readOnly: false }] });
  await acquiring;
  expect(test.phases).toEqual(["acquiring", "connecting", "controlled"]);
  expect(test.input).toHaveBeenLastCalledWith("%0", true);
  expect(test.events.indexOf("input:true")).toBeLessThan(
    test.events.indexOf("controlled"),
  );
});

it("releases a granted lease after attachment failure and blocks input", async () => {
  const call = vi.fn(
    async (family: string, action: string): Promise<Receipt> => {
      if (family === "control" && action === "acquire")
        return { leaseFile: "lease.json" };
      if (family === "attach") throw new Error("session_unavailable");
      if (family === "recovery") return { control: [] };
      return { ok: true };
    },
  );
  const test = context(call);
  await expect(acquireControl(test.value)).rejects.toThrow(
    "session_unavailable",
  );
  expect(test.phases).toEqual([
    "acquiring",
    "connecting",
    "releasing",
    "read-only",
  ]);
  expect(test.value.view.leaseFile).toBeUndefined();
  expect(test.input.mock.calls.some((args) => args[1] === true)).toBe(false);
  expect(call).toHaveBeenCalledWith("control", "release", {
    leaseFile: "lease.json",
  });
});

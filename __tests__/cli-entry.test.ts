import { afterEach, expect, it, vi } from "vitest";
import { entryMode } from "../src/cli/entry.js";
import { dispatch } from "../src/commands/index.js";
import { Ui } from "../src/cli/ui.js";

const mocks = vi.hoisted(() => ({
  serve: vi.fn(() => 0),
  support: vi.fn(() => ({ supported: true })),
  launch: vi.fn(async () => ({ ok: true, detached: true })),
}));
vi.mock("../src/commands/serve.js", () => ({
  serveCommand: {
    name: "serve",
    describe: "MCP",
    usage: "pmcp serve",
    run: mocks.serve,
    options: [{ name: "root", describe: "root" }],
  },
}));
vi.mock("../src/tui/startup/host.js", () => ({
  terminalSupport: mocks.support,
}));
vi.mock("../src/tui/startup/entry.js", () => ({
  launchStartup: mocks.launch,
  planStartup: vi.fn(),
}));
afterEach(() => vi.clearAllMocks());

it("keeps bare pipe launches in MCP mode and supported TTY launches interactive", () => {
  expect(entryMode({ stdin: false, stdout: false })).toBe("server");
  expect(entryMode({ stdin: true, stdout: false, term: "xterm" })).toBe(
    "server",
  );
  expect(entryMode({ stdin: true, stdout: true, term: "xterm-256color" })).toBe(
    "terminal",
  );
  expect(entryMode({ stdin: true, stdout: true, term: "dumb" })).toBe("help");
  expect(
    entryMode({ stdin: true, stdout: true, term: "xterm", ci: "true" }),
  ).toBe("help");
});

function context(stdin = true, stdout = true) {
  const data: string[] = [];
  const diagnostics: string[] = [];
  return {
    data,
    diagnostics,
    options: {
      terminal: { stdin, stdout },
      env: { TERM: "xterm-256color" },
      cwd: "/project",
      ui: new Ui({
        stdout: { write: (text) => data.push(text) },
        stderr: { write: (text) => diagnostics.push(text) },
      }),
    },
  };
}

it("opens the simple workspace without writing a receipt over the terminal", async () => {
  const test = context();
  expect(await dispatch([], test.options)).toBe(0);
  expect(mocks.launch).toHaveBeenCalledWith(
    expect.objectContaining({ cwd: "/project" }),
    false,
  );
  expect(mocks.serve).not.toHaveBeenCalled();
  expect(test.data).toEqual([]);
});

it("preserves explicit serve and legacy leading server options regardless of TTY", async () => {
  const test = context();
  await dispatch(["serve"], test.options);
  await dispatch(["--root", "/catalog"], test.options);
  await dispatch([], context(false, false).options);
  expect(mocks.serve).toHaveBeenCalledTimes(3);
  expect(mocks.launch).not.toHaveBeenCalled();
  expect(mocks.support).not.toHaveBeenCalled();
});

it("keeps help and version side-effect free", async () => {
  const test = context();
  await dispatch(["--help"], test.options);
  await dispatch(["--version"], test.options);
  expect(mocks.serve).not.toHaveBeenCalled();
  expect(mocks.launch).not.toHaveBeenCalled();
  expect(mocks.support).not.toHaveBeenCalled();
});

it("shows actionable help instead of waiting for JSON-RPC on an unsupported TTY", async () => {
  mocks.support.mockReturnValueOnce({ supported: false });
  const test = context();
  expect(await dispatch([], test.options)).toBe(0);
  expect(test.diagnostics.join("")).toContain("pmcp tui doctor");
  expect(mocks.serve).not.toHaveBeenCalled();
  expect(mocks.launch).not.toHaveBeenCalled();
});

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, type TestContext } from "vitest";

import { readConfig } from "../../../../src/config.js";
import { compileHooks } from "../../../../src/hooks/compile.js";
import { RUNTIMES } from "../../../../src/hooks/runtimes/index.js";
import { project } from "../../../../src/project/apply.js";
import { doctor } from "../../../../src/project/doctor.js";
import { readSpec } from "../../../../src/project/spec.js";
import {
  compiled,
  decide,
  fixture,
  guard,
  MAILBOX_ON,
  scratchStore,
} from "../../helpers.js";

const RUNTIME_TOOLS = ["claude", "codex", "gemini"] as const;

function makeWorkspace(t: TestContext, toml: string): string {
  const root = mkdtempSync(join(tmpdir(), "pmcp-mailbox-scope-"));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "pmcp.toml"), toml);
  const spec = readSpec(readConfig(join(root, "pmcp.toml")));
  const result = project(spec, { check: false });
  if (result.backup) {
    t.onTestFinished(() =>
      rmSync(result.backup!, { recursive: true, force: true }),
    );
  }
  return root;
}

const runMock = () => ({ missing: true, status: null, stdout: "" });

describe("mailbox event scoping", () => {
  it("projects native config files byte-identical to mailbox-off when scoped to start and prompt", (t) => {
    const baseSessions =
      '[hooks]\ntargets = ["claude", "codex", "gemini"]\n[hooks.guards.shell.in_place_edit]\nmode = "deny"\n[sessions]\nstate_dir = ".state"\n[sessions.registry]\n';
    const tools = '[targets]\ntools = ["claude", "codex", "gemini"]\n';

    const rootOff = makeWorkspace(t, `${tools}${baseSessions}`);
    const rootScoped = makeWorkspace(
      t,
      `${tools}${baseSessions}[sessions.mailbox]\nevents = ["session_start", "prompt"]\n`,
    );
    const rootDefault = makeWorkspace(
      t,
      `${tools}${baseSessions}[sessions.mailbox]\n`,
    );

    // Claude, Codex and Gemini native configurations must match mailbox-off exactly.
    expect(
      readFileSync(join(rootScoped, ".claude/settings.json"), "utf8"),
    ).toBe(readFileSync(join(rootOff, ".claude/settings.json"), "utf8"));
    expect(readFileSync(join(rootScoped, ".codex/hooks.json"), "utf8")).toBe(
      readFileSync(join(rootOff, ".codex/hooks.json"), "utf8"),
    );
    expect(
      readFileSync(join(rootScoped, ".gemini/settings.json"), "utf8"),
    ).toBe(readFileSync(join(rootOff, ".gemini/settings.json"), "utf8"));

    // Compiled policy and lockfile still reflect the mailbox guard.
    expect(
      readFileSync(join(rootScoped, ".agents/pmcp-hooks/policy.json"), "utf8"),
    ).not.toBe(
      readFileSync(join(rootOff, ".agents/pmcp-hooks/policy.json"), "utf8"),
    );
    expect(readFileSync(join(rootScoped, "pmcp.lock"), "utf8")).not.toBe(
      readFileSync(join(rootOff, "pmcp.lock"), "utf8"),
    );

    // Default 4-event mailbox projects unfiltered tool bindings, differing from mailbox-off.
    expect(
      readFileSync(join(rootDefault, ".claude/settings.json"), "utf8"),
    ).not.toBe(readFileSync(join(rootOff, ".claude/settings.json"), "utf8"));
    expect(
      readFileSync(join(rootDefault, ".codex/hooks.json"), "utf8"),
    ).not.toBe(readFileSync(join(rootOff, ".codex/hooks.json"), "utf8"));
    expect(
      readFileSync(join(rootDefault, ".gemini/settings.json"), "utf8"),
    ).not.toBe(readFileSync(join(rootOff, ".gemini/settings.json"), "utf8"));
  });

  it("delivers messages on prompt event and suppresses delivery on tool events", async () => {
    const adapter = RUNTIMES.claude;
    const store = scratchStore({
      mailbox: {
        enabled: true,
        ttlMinutes: 60,
        maxDelivered: 5,
        audit: true,
        events: ["session_start", "prompt"],
      },
    });

    const message = store.mailbox.send({
      from: { alias: "lead" },
      to: ["all"],
      subject: "scope",
      body: "Deliver on prompt only.",
    });

    const policy = compiled(
      [guard("sessions.mailbox", "warn", { roles: {} })],
      {
        targets: ["claude"],
        sessions: {
          staleMs: 30 * 60_000,
          keepBroadcasts: 10,
          mailbox: {
            enabled: true,
            ttlMinutes: 60,
            maxDelivered: 5,
            audit: true,
            events: ["session_start", "prompt"],
          },
        },
      },
    );

    // Tool hook event must not deliver when mailbox events are scoped to prompt and start.
    const toolRaw = fixture("claude", "PreToolUse.Bash");
    const toolInput = adapter.normalize("PreToolUse", toolRaw, "/w")!;
    const toolDecision = await decide(toolInput, policy, { store });
    const renderedTool = adapter.render(toolInput, toolDecision);
    expect(renderedTool.stdout).not.toContain("Deliver on prompt only.");
    expect(renderedTool.stdout).not.toContain(message.id);
    expect(store.mailbox.delivered(toolInput.session.id, message.id)).toBe(
      false,
    );

    // Prompt hook event delivers the pending message.
    const promptRaw = fixture("claude", "UserPromptSubmit");
    const promptInput = adapter.normalize("UserPromptSubmit", promptRaw, "/w")!;
    const promptDecision = await decide(promptInput, policy, { store });
    const renderedPrompt = adapter.render(promptInput, promptDecision);
    expect(renderedPrompt.stdout).toContain("Deliver on prompt only.");
    expect(renderedPrompt.stdout).toContain(message.id);
    expect(store.mailbox.delivered(promptInput.session.id, message.id)).toBe(
      true,
    );

    // Second prompt turn does not repeat delivered message.
    const repeatDecision = await decide(promptInput, policy, { store });
    const renderedRepeat = adapter.render(promptInput, repeatDecision);
    expect(renderedRepeat.stdout).not.toContain("Deliver on prompt only.");
  });

  it("keeps default 4-event behavior when events configuration is omitted", async () => {
    const out = compileHooks(
      {
        hooks: { targets: ["claude"] },
        sessions: {
          mailbox: { ttl_minutes: 45, max_delivered: 3 },
        },
      },
      { root: "/w", tools: new Set(["claude"]) },
    );

    // Omitted events key preserves exact policy.json structure without extra fields.
    expect(out.policy?.sessions.mailbox).toEqual({
      enabled: true,
      ttlMinutes: 45,
      maxDelivered: 3,
      audit: true,
    });

    // Default mailbox delivers on before_tool events.
    const adapter = RUNTIMES.claude;
    const store = scratchStore({ mailbox: MAILBOX_ON });
    const msg = store.mailbox.send({
      from: { alias: "ops" },
      to: ["all"],
      body: "Tool delivery active.",
    });

    const policy = compiled(
      [guard("sessions.mailbox", "warn", { roles: {} })],
      {
        targets: ["claude"],
        sessions: {
          staleMs: 30 * 60_000,
          keepBroadcasts: 10,
          mailbox: MAILBOX_ON,
        },
      },
    );

    const toolRaw = fixture("claude", "PreToolUse.Bash");
    const toolInput = adapter.normalize("PreToolUse", toolRaw, "/w")!;
    const toolDecision = await decide(toolInput, policy, { store });
    const rendered = adapter.render(toolInput, toolDecision);
    expect(rendered.stdout).toContain("Tool delivery active.");
    expect(rendered.stdout).toContain(msg.id);
  });

  it("validates events list in [sessions.mailbox]", (t) => {
    const root = mkdtempSync(join(tmpdir(), "pmcp-invalid-events-"));
    t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));

    const badToml =
      '[targets]\ntools = ["claude"]\n[sessions.mailbox]\nevents = ["unknown_event"]\n';
    writeFileSync(join(root, "pmcp.toml"), badToml);
    expect(() => readSpec(readConfig(join(root, "pmcp.toml")))).toThrow(
      /events cannot include unknown_event/u,
    );

    const notListToml =
      '[targets]\ntools = ["claude"]\n[sessions.mailbox]\nevents = "prompt"\n';
    writeFileSync(join(root, "pmcp.toml"), notListToml);
    expect(() => readSpec(readConfig(join(root, "pmcp.toml")))).toThrow(
      /events must be a list of strings/u,
    );
  });

  it("reports mailbox events in pmcp doctor and warns on runtimes lacking prompt/start hooks", (t) => {
    const okRoot = makeWorkspace(
      t,
      '[targets]\ntools = ["claude", "codex"]\n[sessions]\nstate_dir = ".state"\n[sessions.registry]\n[sessions.mailbox]\nevents = ["session_start", "prompt"]\n',
    );
    const okSpec = readSpec(readConfig(join(okRoot, "pmcp.toml")));
    const okFindings = doctor(okSpec, { run: runMock, home: okRoot });
    const okRow = okFindings.find((r) => r.check === "mailbox events");
    expect(okRow).toEqual({
      tool: "project",
      check: "mailbox events",
      status: "ok",
      detail: "listens on session_start, prompt",
    });

    const warnRoot = makeWorkspace(
      t,
      '[targets]\ntools = ["claude", "antigravity"]\n[sessions]\nstate_dir = ".state"\n[sessions.registry]\n[sessions.mailbox]\nevents = ["session_start", "prompt"]\n',
    );
    const warnSpec = readSpec(readConfig(join(warnRoot, "pmcp.toml")));
    const warnFindings = doctor(warnSpec, { run: runMock, home: warnRoot });
    const warnRow = warnFindings.find((r) => r.check === "mailbox events");
    expect(warnRow).toMatchObject({
      tool: "project",
      check: "mailbox events",
      status: "warn",
    });
    expect(warnRow?.detail).toContain("listens on session_start, prompt");
    expect(warnRow?.detail).toContain(
      "antigravity lacks prompt and session_start hooks",
    );
    expect(warnRow?.detail).toContain("pmcp sessions inbox fallback");
  });
});

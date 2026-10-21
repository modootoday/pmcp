import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";
import { afterEach, describe, expect, it } from "vitest";

import { ConfigError, readConfig } from "../src/config.js";
import { publicMarketplaceRoot } from "../src/marketplace/builtin.js";
import { readMarketplaces } from "../src/marketplace/declared/index.js";
import { project } from "../src/project/apply.js";
import type { Runner } from "../src/project/doctor.js";
import { marketplaceDoctor } from "../src/project/marketplaces.js";
import { readSpec } from "../src/project/spec.js";

const roots: string[] = [];
afterEach(() => {
  for (const item of roots.splice(0))
    rmSync(item, { recursive: true, force: true });
});
function fixture(toml: string): string {
  const root = mkdtempSync(join(tmpdir(), "pmcp-marketplaces-"));
  roots.push(root);
  writeFileSync(join(root, "pmcp.toml"), toml);
  return root;
}
const spec = (root: string) => readSpec(readConfig(join(root, "pmcp.toml")));
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));

const DECLARED = `
[marketplaces.team]
source = { path = "market" }
catalog = true
[marketplaces.team.plugins]
fleet = { targets = ["claude", "codex"] }
zustand-5 = { targets = ["codex"] }
lsp = { targets = ["claude"] }

[marketplaces.remote]
source = { github = "owner/repo", ref = "main" }
[marketplaces.remote.plugins]
tool = { targets = ["codex"] }

[marketplaces.pmcp]
source = { builtin = true }
catalog = false
[marketplaces.pmcp.plugins]
pmcp = { targets = ["claude"] }
`;

const BASE = `
[targets]
tools = ["claude", "codex"]

[sessions]
state_dir = ".state"
[sessions.registry]

[mcp.docs]
command = "node"
args = ["server.js"]

[catalog]
marketplaces = ["vendor/legacy"]

[ui.claude]
status_band = false
`;

describe("[marketplaces] declaration", () => {
  it("adds catalog = true path sources to [catalog] marketplaces and lets a builtin opt out", () => {
    const root = fixture(`${BASE}${DECLARED}`);
    const { catalog } = readConfig(join(root, "pmcp.toml"));
    expect(catalog.marketplaces).toEqual([
      join(root, "vendor/legacy"),
      join(root, "market"),
    ]);
    expect(catalog.builtin).toBe(false);
  });

  it.each([
    [
      '[marketplaces.a]\nsource = { path = "x", builtin = true }\n',
      "exactly one",
    ],
    [
      '[marketplaces.a]\nsource = { github = "owner/repo" }\ncatalog = true\n',
      "path or builtin",
    ],
    [
      "[marketplaces.a]\nsource = { builtin = true }\nextra = 1\n",
      "unknown key extra",
    ],
    [
      '[marketplaces.a]\nsource = { builtin = true }\nplugins = { p = { targets = ["gemini"] } }\n',
      "unknown target gemini",
    ],
    ["[marketplaces.A]\nsource = { builtin = true }\n", "use lowercase"],
  ])("refuses %j", (toml, message) => {
    const root = fixture(toml);
    expect(() => readConfig(join(root, "pmcp.toml"))).toThrow(ConfigError);
    expect(() => readConfig(join(root, "pmcp.toml"))).toThrow(message);
  });

  it("reads nothing when the table is missing", () => {
    expect(
      readMarketplaces(undefined, "/repo", (m) => {
        throw new Error(m);
      }),
    ).toEqual([]);
  });
});

describe("[marketplaces] projection", () => {
  it("writes owned Claude keys and Codex tables beside the MCP block", () => {
    const root = fixture(`${BASE}${DECLARED}`);
    expect(project(spec(root), { check: false }).code).toBe(0);
    const settings = json(join(root, ".claude/settings.json"));
    expect(settings.extraKnownMarketplaces).toEqual({
      team: { source: { source: "directory", path: join(root, "market") } },
      pmcp: { source: { source: "directory", path: publicMarketplaceRoot() } },
    });
    expect(settings.enabledPlugins).toEqual({
      "fleet@team": true,
      "lsp@team": true,
      "pmcp@pmcp": true,
    });
    const text = readFileSync(join(root, ".codex/config.toml"), "utf8");
    expect(text.match(/>>> pmcp project/gu)).toHaveLength(1);
    const codex = parse(text) as Record<string, any>;
    expect(Object.keys(codex["mcp_servers"])).toEqual(["docs"]);
    expect(codex["marketplaces"]).toEqual({
      remote: {
        source_type: "git",
        source: "https://github.com/owner/repo.git",
        ref: "main",
      },
      team: { source_type: "local", source: join(root, "market") },
    });
    expect(Object.keys(codex["plugins"]).sort()).toEqual([
      "fleet@team",
      "tool@remote",
      "zustand-5@team",
    ]);
    expect(project(spec(root), { check: true }).code).toBe(0);
  });

  it("removes the owned keys once the declaration is gone", () => {
    const root = fixture(`${BASE}${DECLARED}`);
    project(spec(root), { check: false });
    writeFileSync(join(root, "pmcp.toml"), BASE);
    expect(project(spec(root), { check: false }).code).toBe(0);
    const settings = json(join(root, ".claude/settings.json"));
    expect(settings.extraKnownMarketplaces ?? {}).toEqual({});
    expect(settings.enabledPlugins ?? {}).toEqual({});
    const codex = parse(readFileSync(join(root, ".codex/config.toml"), "utf8"));
    expect(codex["marketplaces"]).toBeUndefined();
    expect(Object.keys(codex["mcp_servers"] as object)).toEqual(["docs"]);
  });

  it("projects the [ui.claude] switches for the mod and refuses them without the session hooks", () => {
    const root = fixture(BASE);
    project(spec(root), { check: false });
    expect(json(join(root, ".agents/pmcp-hooks/ui-claude.json"))).toEqual({
      sessionsPane: true,
      statusBand: false,
      commands: true,
      holdForeignEdits: true,
    });
    const bare = fixture('[targets]\ntools = ["claude"]\n[ui.claude]\n');
    expect(() => spec(bare)).toThrow("needs the session hooks");
    const unknown = fixture(
      '[sessions]\nstate_dir = "s"\n[ui.claude]\npane = true\n',
    );
    expect(() => spec(unknown)).toThrow("unknown key pane");
  });
});

describe("[marketplaces] doctor for Codex", () => {
  const listed = readFileSync(
    join(import.meta.dirname, "fixtures/codex-plugin-list-0.163.0.json"),
    "utf8",
  );
  const runner =
    (stdout: string, missing = false): Runner =>
    () => ({ missing, status: 0, stdout });

  it("prints the exact codex commands for missing installs, marketplaces and drift", () => {
    const root = fixture(`${BASE}${DECLARED}`);
    const findings = marketplaceDoctor(
      spec(root),
      runner(`warning: noise\n${listed}`),
    );
    const byCheck = new Map(findings.map((f) => [f.check, f]));
    expect(byCheck.get("marketplace team")?.status).toBe("ok");
    expect(byCheck.get("plugin fleet@team")?.status).toBe("ok");
    expect(byCheck.get("plugin zustand-5@team")?.detail).toBe(
      "not installed; run: codex plugin add zustand-5@team",
    );
    expect(byCheck.get("plugin extra@team")?.detail).toContain(
      "enabled but not declared",
    );
    expect(byCheck.get("marketplace remote")?.detail).toContain(
      "codex plugin marketplace add owner/repo --ref main",
    );
  });

  it("skips when codex is not installed and stays silent without Codex plugins", () => {
    const root = fixture(`${BASE}${DECLARED}`);
    expect(marketplaceDoctor(spec(root), runner("", true))).toEqual([
      { tool: "codex", check: "declared plugins", status: "skip" },
    ]);
    expect(marketplaceDoctor(spec(fixture(BASE)), runner(listed))).toEqual([]);
  });
});

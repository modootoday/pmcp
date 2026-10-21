import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  pluginBinaryDoctor,
  resolvePluginCommand,
} from "../src/project/mcp-spec/plugin-binary.js";
import { readMcp } from "../src/project/mcp-spec/read.js";
import type { McpServerSpec } from "../src/project/spec.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

// A scratch install with this host's platform package holding the given binaries; returns the
// file to resolve from, as the installed pmcp would.
function install(binaries: string[]): { from: string; bin: string } {
  const root = mkdtempSync(join(tmpdir(), "pmcp-plugin-bin-"));
  directories.push(root);
  const name = `pmcp-${process.platform}-${process.arch}`;
  const dir = join(root, "node_modules", "@modootoday", name);
  mkdirSync(join(dir, "bin"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: `@modootoday/${name}` }),
  );
  for (const binary of binaries) {
    writeFileSync(join(dir, "bin", binary), "#!/bin/sh\n");
    chmodSync(join(dir, "bin", binary), 0o755);
  }
  return { from: join(root, "entry.js"), bin: join(dir, "bin") };
}

const server = (command: string): McpServerSpec => ({
  command,
  args: [],
  env: {},
});

it("resolves a bare plugin name to the platform package and keeps everything else", () => {
  const { from, bin } = install(["pmcp-browser"]);
  expect(resolvePluginCommand("pmcp-browser", from)).toBe(
    join(bin, "pmcp-browser"),
  );
  expect(resolvePluginCommand("/opt/pmcp-browser", from)).toBe(
    "/opt/pmcp-browser",
  );
  expect(resolvePluginCommand("node", from)).toBe("node");
  // Missing from the package (as on macOS) or no package at all: stays bare.
  expect(resolvePluginCommand("pmcp-desktop", from)).toBe("pmcp-desktop");
  expect(resolvePluginCommand("pmcp-browser", join(tmpdir(), "x.js"))).toBe(
    "pmcp-browser",
  );
});

it("reports where a plugin command resolved, or why it did not", () => {
  const { from, bin } = install(["pmcp-browser"]);
  const findings = pluginBinaryDoctor(
    {
      web: server(join(bin, "pmcp-browser")),
      desk: server("pmcp-desktop"),
      own: server("/opt/tools/pmcp-browser"),
      other: server("node"),
    },
    from,
  );
  expect(findings).toEqual([
    {
      tool: "project",
      check: "[mcp.web] pmcp-browser",
      status: "ok",
      detail: `resolved to ${join(bin, "pmcp-browser")} (platform package)`,
    },
    {
      tool: "project",
      check: "[mcp.desk] pmcp-desktop",
      status: "warn",
      detail: `not resolved: @modootoday/pmcp-${process.platform}-${process.arch} has no pmcp-desktop; runs pmcp-desktop from PATH`,
    },
    {
      tool: "project",
      check: "[mcp.own] pmcp-browser",
      status: "ok",
      detail: "explicit command kept: /opt/tools/pmcp-browser",
    },
  ]);
  expect(pluginBinaryDoctor({ web: server("pmcp-browser") })[0]).toMatchObject({
    status: "warn",
    detail: expect.stringContaining("package is installed"),
  });
});

it("reads [mcp] through the resolver: explicit paths kept, unresolved names bare", () => {
  const servers = readMcp("pmcp.toml", {
    web: { command: "pmcp-browser" },
    own: { command: "/opt/tools/pmcp-desktop", args: ["mcp"] },
  });
  // No platform package is installed in the repository.
  expect(servers["web"]!.command).toBe("pmcp-browser");
  expect(servers["own"]!.command).toBe("/opt/tools/pmcp-desktop");
});

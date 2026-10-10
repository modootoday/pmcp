import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { parse } from "smol-toml";

import type { DoctorOptions, Finding } from "./doctor.js";
import type { ProjectSpec, Tool } from "./spec.js";

export interface MemoryMetadata {
  readonly state: "enabled" | "disabled" | "unknown" | "unsupported";
  readonly path?: string;
  readonly pathScope?: "store" | "base";
  readonly exists?: boolean;
  readonly source: string;
  readonly contextFileNames?: readonly string[];
}

export interface MemoryFinding extends Finding {
  readonly memory: MemoryMetadata;
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Configuration is not an object");
  }
  return value as Record<string, unknown>;
}

function settings(file: string, toml = false): Record<string, unknown> {
  if (!existsSync(file)) {
    return {};
  }
  const text = readFileSync(file, "utf8");
  return object(toml ? parse(text) : JSON.parse(text));
}

function configuredState(value: unknown): MemoryMetadata["state"] {
  if (value === true) {
    return "enabled";
  }
  if (value === false) {
    return "disabled";
  }
  return "unknown";
}

function located(
  metadata: MemoryMetadata,
  path: string,
  pathScope: "base" | "store",
): MemoryMetadata {
  return { ...metadata, path, pathScope, exists: existsSync(path) };
}

function metadata(
  tool: Tool,
  spec: ProjectSpec,
  options: DoctorOptions,
): MemoryMetadata {
  const env = options.env ?? {};
  const directory = (name: string, fallback: string) =>
    resolve(spec.root, env[name] ?? join(options.home, fallback));
  if (tool === "antigravity") {
    return {
      state: "unsupported",
      source:
        "No qualified native memory API; brain trajectories are not memory",
    };
  }
  if (tool === "codex") {
    const home = directory("CODEX_HOME", ".codex");
    const result = options.run(
      "codex",
      ["features", "list"],
      spec.root,
      options.env,
    );
    const match = result.stdout.match(
      /^memories\s+\S+(?:\s+\S+)*\s+(true|false)\s*$/mu,
    );
    const state =
      result.status === 0 && match
        ? configuredState(match[1] === "true")
        : "unknown";
    return located(
      {
        state,
        source: result.missing
          ? "Native CLI not installed"
          : "codex features list; active session overrides are not inspected",
      },
      join(home, "memories"),
      "store",
    );
  }
  const version = options.run(tool, ["--version"], spec.root, options.env);
  if (version.missing || version.status !== 0) {
    return {
      state: "unknown",
      source: "Native CLI unavailable; memory configuration not inspected",
    };
  }
  if (tool === "claude") {
    const home = directory("CLAUDE_CONFIG_DIR", ".claude");
    const user = settings(join(home, "settings.json"));
    const state =
      env["CLAUDE_CODE_DISABLE_AUTO_MEMORY"] === "1"
        ? "disabled"
        : configuredState(user["autoMemoryEnabled"]);
    const source =
      "User configuration and disable environment flag; project trust and active session overrides are not inspected";
    const override = user["autoMemoryDirectory"];
    if (typeof override === "string") {
      const path = override.startsWith("~/")
        ? join(options.home, override.slice(2))
        : override;
      if (!isAbsolute(path)) {
        return {
          state: "unknown",
          source: "Invalid autoMemoryDirectory metadata; value redacted",
        };
      }
      return located({ state, source }, path, "store");
    }
    const projectName = env["CLAUDE_CODE_PROJECT_DIR_NAME"];
    if (
      env["CLAUDE_CONFIG_DIR"] &&
      projectName &&
      !projectName.includes("/") &&
      !projectName.includes("\\") &&
      projectName !== "." &&
      projectName !== ".."
    ) {
      return located(
        { state, source },
        join(home, "projects", projectName, "memory"),
        "store",
      );
    }
    return located(
      {
        state,
        source: `${source}; native project directory encoding is not guessed`,
      },
      join(home, "projects"),
      "base",
    );
  }
  if (tool === "grok") {
    const home = join(options.home, ".grok");
    const user = settings(join(home, "config.toml"), true);
    const project = settings(join(spec.root, ".grok/config.toml"), true);
    const userMemory =
      user["memory"] === undefined ? {} : object(user["memory"]);
    const projectMemory =
      project["memory"] === undefined ? {} : object(project["memory"]);
    const overridden = projectMemory["enabled"] !== undefined;
    const state = overridden
      ? "unknown"
      : configuredState(userMemory["enabled"]);
    return located(
      {
        state,
        source:
          "User memory configuration; project trust and workspace encoding are not exposed by a read-only native memory command",
      },
      join(home, "memory-v2/workspaces"),
      "base",
    );
  }
  const home = directory("GEMINI_CLI_HOME", ".gemini");
  const user = settings(join(home, "settings.json"));
  const context = user["context"] === undefined ? {} : object(user["context"]);
  const names = context["fileName"] ?? "GEMINI.md";
  const contextFileNames = typeof names === "string" ? [names] : names;
  if (
    !Array.isArray(contextFileNames) ||
    !contextFileNames.every((name) => typeof name === "string")
  ) {
    return {
      state: "unknown",
      source: "Invalid context filename metadata; values redacted",
    };
  }
  return located(
    {
      state: "unknown",
      source:
        "Global memory file existence and user context filenames; active memory tool enablement is not exposed",
      contextFileNames,
    },
    join(home, "GEMINI.md"),
    "store",
  );
}

export function memoryFindings(
  spec: ProjectSpec,
  options: DoctorOptions,
): MemoryFinding[] {
  const findings: MemoryFinding[] = [];
  for (const tool of spec.tools) {
    if (options.only && !options.only.has(tool)) {
      continue;
    }
    let memory: MemoryMetadata;
    try {
      memory = metadata(tool, spec, options);
    } catch {
      memory = {
        state: "unknown",
        source: "Cannot read configuration metadata; contents are redacted",
      };
    }
    findings.push({
      tool,
      check: "native memory metadata",
      status: memory.state === "enabled" ? "ok" : "skip",
      detail: `${memory.state}${memory.path ? `; ${memory.pathScope}: ${memory.path}; exists=${memory.exists}` : ""}`,
      memory,
    });
  }
  return findings;
}

import { spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { parse } from "smol-toml";

import { launch } from "./mcp.js";
import { ProjectError } from "./package-rules.js";
import type { ProjectSpec } from "./spec.js";

function sourcePath(file: string, root: string): string {
  if (file.startsWith("~/")) {
    return resolve(homedir(), file.slice(2));
  }
  return resolve(root, file.replaceAll("${PROJECT_ROOT}", root));
}

function sourceValue(file: string, pointer: string): string {
  try {
    if (statSync(file).size > 2 * 1024 * 1024) {
      throw new Error("size");
    }
    const text = readFileSync(file, "utf8").replace(/^\uFEFF/u, "");
    let value: unknown;
    if (file.endsWith(".toml")) {
      value = parse(text);
    } else {
      value = JSON.parse(text);
    }
    for (const segment of pointer.slice(1).split("/")) {
      const key = segment.replaceAll("~1", "/").replaceAll("~0", "~");
      if (
        value === null ||
        typeof value !== "object" ||
        !Object.hasOwn(value, key)
      ) {
        throw new Error("pointer");
      }
      value = (value as Record<string, unknown>)[key];
    }
    if (typeof value !== "string" || value === "" || value.includes("\0")) {
      throw new Error("value");
    }
    return value;
  } catch {
    throw new ProjectError(
      "Cannot load the declared MCP environment source; contents are redacted",
    );
  }
}

export function mcpEnvironment(
  spec: ProjectSpec,
  alias: string,
): Record<string, string> {
  const server = spec.mcp[alias];
  if (!server || server.command === undefined) {
    throw new ProjectError("exec-mcp requires a declared stdio server");
  }
  const result: Record<string, string> = {};
  for (const [key, source] of Object.entries(server.envFrom ?? {})) {
    result[key] = sourceValue(
      sourcePath(source.file, spec.root),
      source.pointer,
    );
  }
  return result;
}

export async function execMcp(
  spec: ProjectSpec,
  alias: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<number> {
  const additions = mcpEnvironment(spec, alias);
  const server = spec.mcp[alias]!;
  const started = launch(server);
  const child = spawn(started.command, [...started.args], {
    cwd: spec.root,
    env: { ...env, ...additions, ...started.env },
    stdio: "inherit",
  });
  const interrupt = () => {
    child.kill("SIGINT");
  };
  const terminate = () => {
    child.kill("SIGTERM");
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    return await new Promise<number>((done, reject) => {
      child.once("error", () =>
        reject(
          new ProjectError(
            "Cannot start the declared MCP server; launch details are redacted",
          ),
        ),
      );
      child.once("exit", (code, signal) => {
        if (code !== null) {
          done(code);
          return;
        }
        done(signal === "SIGINT" ? 130 : 143);
      });
    });
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
}

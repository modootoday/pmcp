import { describe, expect, it } from "vitest";

import { registerSkillTools, SERVER_NAME } from "../src/mcp.js";
import { createSkillTools } from "../src/server.js";
import { resolveRoots } from "../src/stdio.js";

interface Registered {
  readonly name: string;
  readonly config: { readonly annotations?: Record<string, unknown> };
  readonly handler: (args: Record<string, unknown>) => Promise<unknown>;
}

function fakeServer() {
  const tools: Registered[] = [];
  const server = {
    registerTool(
      name: string,
      config: Registered["config"],
      handler: Registered["handler"],
    ) {
      tools.push({ name, config, handler });
      return server;
    },
  };
  return { server, tools };
}

const entries = [
  {
    name: "@acme/runner/adoption",
    package: "@acme/runner",
    slug: "adoption",
    description: "Wire the stage runner",
    path: "/nowhere/SKILL.md",
  },
];
const tools = () => createSkillTools({ roots: [], loadCatalog: () => entries });

describe("registerSkillTools", () => {
  // Three, whatever the catalog holds. The whole package is the claim that a
  // session's startup listing does not grow with the number of skills.
  it("registers exactly three tools", () => {
    const { server, tools: registered } = fakeServer();
    registerSkillTools(server as never, tools());
    expect(registered.map((t) => t.name)).toEqual([
      "skill_catalog",
      "skill_find",
      "skill_call",
    ]);
  });

  it("marks every tool read-only and non-destructive", () => {
    const { server, tools: registered } = fakeServer();
    registerSkillTools(server as never, tools());
    for (const tool of registered) {
      expect(tool.config.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
      });
    }
  });

  it("names the server so a host can tell which one answered", () => {
    expect(SERVER_NAME).toBe("pmcp");
  });

  it("returns matches from skill_find without a body", async () => {
    const { server, tools: registered } = fakeServer();
    registerSkillTools(server as never, tools());
    const find = registered.find((t) => t.name === "skill_find")!;
    const result = (await find.handler({ intent: "stage runner" })) as {
      content: { text: string }[];
    };
    expect(result.content[0]!.text).toContain("@acme/runner/adoption");
    expect(result.content[0]!.text).toContain("lexical");
  });

  it("answers skill_call for an unknown name with an error rather than throwing", async () => {
    const { server, tools: registered } = fakeServer();
    registerSkillTools(server as never, tools());
    const call = registered.find((t) => t.name === "skill_call")!;
    const result = (await call.handler({ name: "@acme/nothing/x" })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("unknown_skill");
  });
});

describe("resolveRoots", () => {
  it("uses the arguments given", () => {
    expect(
      resolveRoots(["/a/node_modules", "/b/node_modules"], "/cwd"),
    ).toEqual(["/a/node_modules", "/b/node_modules"]);
  });

  it("ignores flags when deciding whether roots were given", () => {
    expect(resolveRoots(["--scope=@acme/"], "/cwd")).toEqual([
      "/cwd/node_modules",
    ]);
  });

  it("falls back to the working directory's node_modules", () => {
    expect(resolveRoots([], "/cwd")).toEqual(["/cwd/node_modules"]);
  });
});

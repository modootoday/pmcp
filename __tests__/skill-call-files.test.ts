import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { registerSkillTools } from "../src/mcp.js";
import { createSkillTools } from "../src/server.js";

interface Registered {
  name: string;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function catalog() {
  const root = mkdtempSync(join(tmpdir(), "skill-call-files-"));
  const skill = (slug: string) => join(root, "skills", slug);
  write(
    join(skill("guided"), "SKILL.md"),
    "---\nname: guided\ndescription: Guided.\n---\n\nFollow references/steps.md.\n",
  );
  write(join(skill("guided"), "references/steps.md"), "1. Do it.\n");
  write(join(skill("guided"), "scripts/check.sh"), "echo ok\n");
  write(
    join(skill("plain"), "SKILL.md"),
    "---\nname: plain\ndescription: Plain.\n---\n\nJust this.\n",
  );
  const entry = (slug: string) => ({
    name: `@acme/kit/${slug}`,
    package: "@acme/kit",
    slug,
    description: slug,
    path: join(skill(slug), "SKILL.md"),
  });
  return createSkillTools({
    roots: [],
    loadCatalog: () => [entry("guided"), entry("plain")],
  });
}

function skillCall() {
  const registered: Registered[] = [];
  const server = {
    registerTool(
      name: string,
      _config: unknown,
      handler: Registered["handler"],
    ) {
      registered.push({ name, handler });
      return server;
    },
  };
  registerSkillTools(server as never, catalog());
  return registered.find((tool) => tool.name === "skill_call")!.handler;
}

describe("skill_call", () => {
  it("lists the files a skill carries after its body, so skill_read can fetch them", async () => {
    const result = (await skillCall()({ name: "@acme/kit/guided" })) as {
      content: { text: string }[];
    };
    // Body, the text manifest, then one resource link per carried file.
    expect(result.content).toHaveLength(4);
    expect(result.content[0]!.text.trim()).toBe("Follow references/steps.md.");
    const manifest = result.content[1]!.text;
    expect(manifest).toContain(
      "- references/steps.md (10 bytes, text/markdown",
    );
    expect(manifest).toContain(
      "- scripts/check.sh (8 bytes, text/x-shellscript",
    );
    expect(manifest).not.toContain("SKILL.md");
  });

  it("returns the body alone when the skill carries nothing else", async () => {
    const result = (await skillCall()({ name: "@acme/kit/plain" })) as {
      content: { text: string }[];
    };
    expect(result.content).toHaveLength(1);
  });

  it("reads a listed file through skill_read", () => {
    const read = catalog().read("@acme/kit/guided", "references/steps.md");
    expect(read.ok && read.text).toBe("1. Do it.\n");
  });
});

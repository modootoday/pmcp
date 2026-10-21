import { existsSync, readFileSync, symlinkSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createFilesStore } from "../../../src/sessions/files-store.js";
import { harness, put, saveEvidence } from "./_shared.js";

const afterEdit = {
  validator_glob: "**/.agents/skills/*/validate.cjs",
  command: [process.execPath, "{validator}"],
  debounce_seconds: 60,
  report: "context",
};
const onStop = { project_check: true, report: "context" };
const rows: Record<string, unknown>[] = [];
afterAll(() => saveEvidence("checks", rows));

function validator(root: string, owner: string, code = 1): string {
  const path = join(root, owner, ".agents/skills/test/validate.cjs");
  put(
    path,
    `require("node:fs").appendFileSync(${JSON.stringify(join(root, "validator-calls"))}, ${JSON.stringify(owner + "\n")});\nconsole.error("fake-secret-output");\nprocess.exitCode = ${code};\n`,
  );
  return path;
}

function projection(root: string, code = 2): void {
  put(
    join(root, "pmcp.lock"),
    JSON.stringify({ version: 1, pmcp_version: "0.17.4", outputs: [] }),
  );
  put(
    join(root, "node_modules/@modootoday/pmcp/dist/cli.js"),
    `if (process.argv[2] === "--version") console.log("0.17.4");\nelse {\nrequire("node:fs").appendFileSync(${JSON.stringify(join(root, "projection-calls"))}, process.argv.slice(2).join(" ") + "\\n");\nconsole.error("x drift: .codex/hooks.json");\nprocess.exitCode = ${code};\n}\n`,
  );
}

describe.each(["claude", "codex"] as const)(
  "checks on recorded %s input",
  (runtime) => {
    it("validates only the edited package and debounces across store instances", async () => {
      const h = harness(runtime, { checks: { after_edit: afterEdit } });
      validator(h.root, "packages/one");
      validator(h.root, "packages/two");
      const path = join(h.root, "packages/one/src/a.ts");
      const first = await h.edit(path);
      expect(first.decision.verdict).toBeUndefined();
      expect(first.decision.context?.[0]).toContain("packages/one");
      expect(first.rendered.stdout).not.toContain("fake-secret-output");
      h.reloadStore();
      const second = await h.edit(path);
      expect(second.decision.context).toBeUndefined();
      expect(readFileSync(join(h.root, "validator-calls"), "utf8")).toBe(
        "packages/one\n",
      );
      expect(
        createFilesStore(h.store.dir).registry.get("session-0001")?.["checks"],
      ).toBeDefined();
      expect(h.failures()).toBe(1);
      rows.push(...h.rows);
    });
    it("validates success quietly and skips unrelated or escaping paths", async () => {
      const h = harness(runtime, { checks: { after_edit: afterEdit } });
      validator(h.root, "packages/one", 0);
      expect(
        (await h.edit(join(h.root, "packages/one/a.ts"))).decision,
      ).toEqual({});
      expect((await h.edit(join(h.root, "elsewhere/a.ts"))).decision).toEqual(
        {},
      );
      expect((await h.edit(join(h.root, "../outside.ts"))).decision).toEqual(
        {},
      );
      rows.push(...h.rows);
    });
    it("ignores validators resolving outside the project", async () => {
      const h = harness(runtime, { checks: { after_edit: afterEdit } });
      const other = harness(runtime, {});
      const outside = validator(other.root, "packages/one");
      const inside = validator(h.root, "packages/one");
      unlinkSync(inside);
      symlinkSync(outside, inside);
      expect(
        (await h.edit(join(h.root, "packages/one/a.ts"))).decision,
      ).toEqual({});
      expect(existsSync(join(other.root, "validator-calls"))).toBe(false);
      rows.push(...h.rows);
    });
    it("runs projection checks only after edits and never on active stops", async () => {
      const h = harness(runtime, { checks: { on_stop: onStop } });
      projection(h.root);
      expect((await h.run("Stop")).decision).toEqual({});
      await h.edit(join(h.root, "sample.ts"));
      expect(
        (await h.run("Stop", { stop_hook_active: true })).decision,
      ).toEqual({});
      const stopped = await h.run("Stop");
      expect(readFileSync(join(h.root, "projection-calls"), "utf8")).toBe(
        "project --check\n",
      );
      expect(stopped.decision.verdict).toBeUndefined();
      if (runtime === "claude")
        expect(stopped.decision.context?.[0]).toContain("projection");
      if (runtime === "codex") {
        expect(stopped.decision.context).toBeUndefined();
        expect(stopped.rendered.stdout).toBe("{}\n");
      }
      await h.edit(join(h.root, "sample.ts"));
      expect((await h.run("Stop")).decision).toEqual({});
      const prompted = await h.run("UserPromptSubmit");
      if (runtime === "codex")
        expect(prompted.decision.context?.[0]).toContain("projection");
      if (runtime === "claude")
        expect(prompted.decision.context).toBeUndefined();
      expect((await h.run("UserPromptSubmit")).decision).toEqual({});
      await h.run("Stop", { prompt_id: "turn-two", turn_id: "turn-two" });
      expect(
        readFileSync(join(h.root, "projection-calls"), "utf8")
          .split("\n")
          .filter(Boolean),
      ).toHaveLength(2);
      rows.push(...h.rows);
    });
    it("keeps successful projection checks quiet", async () => {
      const h = harness(runtime, { checks: { on_stop: onStop } });
      projection(h.root, 0);
      await h.edit(join(h.root, "sample.ts"));
      expect((await h.run("Stop")).decision).toEqual({});
      expect((await h.run("UserPromptSubmit")).decision).toEqual({});
      rows.push(...h.rows);
    });
    it("uses independent validator stamps and reruns after the debounce expires", async () => {
      const clock = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
      try {
        const h = harness(runtime, { checks: { after_edit: afterEdit } });
        validator(h.root, "packages/one", 0);
        validator(h.root, "packages/two", 0);
        await h.edit(join(h.root, "packages/one/a.ts"));
        await h.edit(join(h.root, "packages/two/a.ts"));
        await h.edit(join(h.root, "packages/one/b.ts"));
        clock.mockReturnValue(1_800_000_060_001);
        await h.edit(join(h.root, "packages/one/a.ts"));
        expect(readFileSync(join(h.root, "validator-calls"), "utf8")).toBe(
          "packages/one\npackages/two\npackages/one\n",
        );
        rows.push(...h.rows);
      } finally {
        clock.mockRestore();
      }
    });
  },
);

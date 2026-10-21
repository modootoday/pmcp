import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { holderOf, placeOf, waitingOf } from "../../../src/ui/claude/model.js";

const DESK = "/w/.claude/worktrees/desk-review";

describe("session rows name the desk, the lease holder and the reason", () => {
  it("names a detached linked desk by its directory, not '-'", () => {
    expect(placeOf({ session: "p", branch: "", worktree: DESK })).toBe(
      "desk-review",
    );
    expect(
      placeOf({
        session: "p",
        branch: "worktree-a",
        worktree: "/w/.claude/worktrees/a",
      }),
    ).toBe("a");
    expect(placeOf({ session: "m", branch: "main", worktree: "/w" })).toBe(
      "main",
    );
    expect(
      placeOf({ session: "d", branch: "", worktree: "/elsewhere/desk" }),
    ).toBe("desk");
    expect(placeOf({ session: "x" })).toBe("-");
  });

  it("names the session holding a lease", () => {
    const records = [
      { session: "aaaaaaaa-1", pid: 10, worktree: "/w" },
      { session: "bbbbbbbb-2", alias: "lander", pid: 20, worktree: DESK },
    ];
    const lease = { pid: 20, subject: "land", since: "" };
    expect(holderOf(lease, records)).toBe("lander");
    expect(holderOf({ ...lease, pid: 99, cwd: DESK }, records)).toBe("lander");
    expect(holderOf({ ...lease, pid: 99, cwd: "/w/x" }, records)).toBe(
      "pid 99",
    );
  });

  it("shows input, never empty parentheses, for an unknown waiting reason", () => {
    expect(waitingOf({ session: "p", status: "waiting", waiting: "" })).toBe(
      "input",
    );
    expect(waitingOf({ session: "p", waiting: "permission_prompt" })).toBe(
      "permission",
    );
  });

  it("spins the pane header and the band only through bandMark", () => {
    const draw = readFileSync(
      join(import.meta.dirname, "../../../src/ui/claude/draw.tsx"),
      "utf8",
    );
    const spinners = draw.match(/module="\.\/spinner\.tsx"/gu) ?? [];
    const guarded =
      draw.match(/\.spin \? \(\s*<Client[^>]*?module="\.\/spinner\.tsx"/gu) ??
      [];
    expect(spinners.length).toBe(2);
    expect(guarded.length).toBe(spinners.length);
  });

  it("puts the holder in the pane and band lease rows", () => {
    const draw = readFileSync(
      join(import.meta.dirname, "../../../src/ui/claude/draw.tsx"),
      "utf8",
    );
    expect(draw.match(/holderOf\(/gu)?.length).toBe(2);
  });
});

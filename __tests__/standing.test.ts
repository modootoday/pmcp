import { expect, it } from "vitest";
import { Ui } from "../src/cli/ui.js";
import { sayStanding } from "../src/commands/standing.js";

// Capturing the real UI detects output sent to the wrong stream.
function said(line: Parameters<typeof sayStanding>[1]): string {
  let out = "";
  let err = "";
  const ui = new Ui({
    stdout: { write: (text: string) => void (out += text) },
    stderr: { write: (text: string) => void (err += text) },
    color: false,
  });
  sayStanding(
    {
      ui,
      args: { positional: [], options: new Map(), flags: new Set() },
      env: {},
      cwd: ".",
    },
    line,
  );
  return out + err;
}

it("says nothing about the current line", () => {
  // Annotating routine output would make exceptional annotations harder to notice.
  expect(said({ major: 4, status: "active" })).toBe("");
});

it("says a frozen line stopped, and where", () => {
  const text = said({ major: 3, status: "frozen" });
  expect(text).toContain("3.x");
  expect(text).toContain("no longer revised");
});

it("leads with the recall and names what to do", () => {
  const text = said({
    major: 1,
    status: "recalled",
    recall: {
      advisoryUrl: "https://github.com/advisories/GHSA-example",
      severity: "critical",
      summary: "Remote code execution in the range this line covers.",
      reverifyAt: "1.6.1",
    },
  });
  expect(text).toContain("recalled");
  expect(text).toContain("critical");
  expect(text).toContain("https://github.com/advisories/GHSA-example");
  expect(text).toContain("1.6.1");
});

it("says to leave the line when nothing in it is safe", () => {
  const text = said({
    major: 1,
    status: "recalled",
    recall: {
      advisoryUrl: "https://github.com/advisories/GHSA-example",
      severity: "critical",
      summary: "Every release in this line is covered.",
    },
  });
  expect(text).toContain("newer major");
  expect(text).not.toContain("the fix is in");
});

it("says nothing at all to a reader whose catalog predates lines", () => {
  expect(said(undefined)).toBe("");
});

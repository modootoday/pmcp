import { describe, expect, it } from "vitest";

import { readConfig } from "../../src/config.js";
import { readSpec } from "../../src/project/spec.js";
import { claudeOnly, fixture, list, rejects } from "./_shared.js";

describe("[permissions.claude] reader", () => {
  it("accepts allow, ask and deny and deduplicates in declaration order", (t) => {
    const { config } = fixture(
      t,
      `${claudeOnly}[permissions.claude]\nallow = ["Bash(npm test)", "WebFetch(domain:example.com)", "mcp__docs__search"]\nask = ["Read(.env)", "Read(.env)", "Bash(git push:*)"]\ndeny = []\n`,
    );
    expect(readSpec(readConfig(config)).permissions?.claude).toEqual({
      allow: [
        "Bash(npm test)",
        "WebFetch(domain:example.com)",
        "mcp__docs__search",
      ],
      ask: ["Read(.env)", "Bash(git push:*)"],
      deny: [],
    });
  });

  it("rejects unknown keys, bad types and other runtimes", (t) => {
    rejects(
      t,
      "[permissions.claude]\nprompt = []\n",
      "[permissions.claude] unknown key prompt",
    );
    rejects(
      t,
      "[permissions.codex]\nask = []\n",
      "[permissions] unknown key codex",
    );
    const root = fixture(t, `permissions = 1\n${claudeOnly}`).config;
    expect(() => readSpec(readConfig(root))).toThrow(
      "[permissions] must be a table",
    );
    rejects(
      t,
      '[permissions.claude]\nask = "Read(.env)"\n',
      "[permissions.claude] ask must be a list of strings",
    );
    rejects(
      t,
      '[permissions.claude]\nask = [""]\n',
      "[permissions.claude] ask: empty rule",
    );
    rejects(
      t,
      '[permissions.claude]\nask = ["Read(.env)\\u0007"]\n',
      "control character",
    );
  });

  it("rejects expressions outside the pinned native grammar", (t) => {
    for (const bad of [
      "Read(",
      "read(.env)",
      "Bash()",
      "Frobnicate(x)",
      "WebFetch(example.com)",
      "mcp__docs(search)",
      "Bash(git :* push)",
      " Read(.env)",
    ])
      rejects(
        t,
        `[permissions.claude]\nask = ${list([bad])}\n`,
        "not a Claude permission rule",
      );
  });

  it("rejects one expression declared in two buckets", (t) => {
    rejects(
      t,
      '[permissions.claude]\nallow = ["Bash(git push:*)"]\nask = ["Bash(git push:*)"]\n',
      "[permissions.claude] Bash(git push:*) is declared in both allow and ask",
    );
  });
});

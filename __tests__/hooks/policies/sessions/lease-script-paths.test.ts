import { describe, expect, it } from "vitest";

import type { RuntimeId } from "../../../../src/hooks/contract.js";
import { startsWith } from "../../../../src/hooks/policies/sessions/leases.js";
import { compiled, guard, runShell, scratchStore } from "../../helpers.js";

// A land script run through its interpreter by any path was missed by the argv prefix match,
// so a separate hook matched paths; a script word in blocks now matches it by path suffix.
const LOCKFILE = {
  lockfile: {
    path: "bun.lock",
    blocks: [
      ["bun", "install"],
      ["node", "tools/runner/src/land-main.mjs"],
      ["node", "sync.mjs"],
    ],
  },
};

describe("startsWith", () => {
  it("matches a script word by basename or path suffix", () => {
    const prefix = ["node", "tools/runner/src/land-main.mjs"];
    expect(
      startsWith(
        ["node", "/abs/ws/tools/runner/src/land-main.mjs", "x"],
        prefix,
      ),
    ).toBe(true);
    expect(startsWith(["node", "tools/runner/src/land-main.mjs"], prefix)).toBe(
      true,
    );
    expect(startsWith(["node", "/abs/other/src/land-main.mjs"], prefix)).toBe(
      false,
    );
    expect(startsWith(["node", "./sync.mjs"], ["node", "sync.mjs"])).toBe(true);
    expect(
      startsWith(["/usr/bin/node", "a/b/sync.mjs"], ["node", "sync.mjs"]),
    ).toBe(true);
    expect(startsWith(["node", "a/resync.mjs"], ["node", "sync.mjs"])).toBe(
      false,
    );
    expect(startsWith(["node", "a/sync.mjs.bak"], ["node", "sync.mjs"])).toBe(
      false,
    );
  });

  it("keeps exact matching for words that are not scripts", () => {
    expect(startsWith(["git", "push"], ["git", "push"])).toBe(true);
    expect(startsWith(["git", "remote/push"], ["git", "push"])).toBe(false);
    expect(startsWith(["bun", "x/install"], ["bun", "install"])).toBe(false);
  });
});

describe.each<RuntimeId>(["claude", "codex"])(
  "sessions.leases script blocks on %s payloads",
  (runtime) => {
    const policy = compiled([guard("sessions.leases", "deny", LOCKFILE)]);
    const held = () => {
      const store = scratchStore();
      store.leases.take("lockfile", { subject: "bump" });
      return store;
    };

    it.each([
      "node /srv/ws/tools/runner/src/land-main.mjs abc123",
      "cd /srv/ws && node tools/runner/src/land-main.mjs",
      "timeout 600 node ./sync.mjs",
    ])("refuses %s while the lease is held", async (command) => {
      expect(
        (await runShell(runtime, policy, command, undefined, held())).verdict,
      ).toBe("deny");
    });

    it.each(["node tools/runner/src/other.mjs", "node land-main.mjs.txt"])(
      "allows %s",
      async (command) => {
        expect(
          (await runShell(runtime, policy, command, undefined, held())).verdict,
        ).toBeUndefined();
      },
    );
  },
);

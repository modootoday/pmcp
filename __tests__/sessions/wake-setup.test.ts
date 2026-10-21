import { describe, expect, it } from "vitest";

import { RUNTIMES } from "../../src/hooks/runtimes/index.js";
import { readMailbox } from "../../src/sessions/settings.js";
import {
  compiled,
  decide,
  fixture,
  guard,
  scratchStore,
} from "../hooks/helpers.js";

describe("where a wake goes", () => {
  it("records the opencode server URL the plugin reports at session start", async () => {
    const store = scratchStore();
    const payload = {
      ...fixture("opencode", "session.created"),
      serverUrl: "http://127.0.0.1:4096",
    };
    const input = RUNTIMES.opencode.normalize(
      "session.created",
      payload,
      "/w",
    )!;
    await decide(input, compiled([guard("sessions.registry", "warn")]), {
      store,
    });
    expect(store.registry.get(input.session.id)?.["wakeUrl"]).toBe(
      "http://127.0.0.1:4096",
    );
  });

  it("reads [sessions.mailbox] wake, absent unless turned on", () => {
    expect(readMailbox({ wake: true }).wake).toBe(true);
    expect(readMailbox({})).not.toHaveProperty("wake");
    expect(() => readMailbox({ wake: "yes" })).toThrow(
      "[sessions.mailbox] wake must be true or false",
    );
  });
});

import { describe, expect, it } from "vitest";

import { RUNTIMES } from "../../../../src/hooks/runtimes/index.js";
import {
  compiled,
  decide,
  fixture,
  guard,
  scratchStore,
} from "../../helpers.js";

const SESSION = "notify-0000";

function notification(extra: Record<string, unknown>) {
  const payload: Record<string, any> = {
    ...fixture("claude", "Stop"),
    hook_event_name: "Notification",
    session_id: SESSION,
    ...extra,
  };
  return RUNTIMES.claude.normalize("Notification", payload, payload["cwd"])!;
}

// The mod tells an idle prompt from a real question by this reason, so it must be recorded.
describe("sessions.registry on a Claude Notification", () => {
  const policy = compiled([guard("sessions.registry", "warn")]);

  it("records the notification type as the waiting reason", async () => {
    const store = scratchStore();
    await decide(
      notification({
        notification_type: "idle_prompt",
        message: "Claude is waiting for your input",
      }),
      policy,
      { store },
    );
    expect(store.registry.get(SESSION)).toMatchObject({
      status: "waiting",
      waiting: "idle_prompt",
    });
    await decide(
      notification({
        notification_type: "permission_prompt",
        message: "Claude needs your permission to use Edit",
      }),
      policy,
      { store },
    );
    expect(store.registry.get(SESSION)?.waiting).toBe("permission_prompt");
  });

  it("falls back to the message when the type is missing", async () => {
    const store = scratchStore();
    await decide(
      notification({ message: "Claude needs your permission to use Bash" }),
      policy,
      { store },
    );
    expect(store.registry.get(SESSION)?.waiting).toBe(
      "Claude needs your permission to use Bash",
    );
  });
});

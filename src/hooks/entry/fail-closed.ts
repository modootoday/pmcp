import { PolicyIntegrityError } from "../compiled.js";
import type { HookInput, NeutralEvent } from "../contract.js";
import type { RuntimeAdapter } from "../runtimes/types.js";

const FAILED_CLOSED = "pmcp hook could not evaluate this call and refused it";

// Only tool calls can be refused; keep other events silent so hook errors cannot block session startup.
export function failClosed(
  adapter: RuntimeAdapter,
  event: NeutralEvent,
  root: string,
  error: unknown,
): string {
  if (event !== "before_tool") return "";
  const reason =
    error instanceof PolicyIntegrityError ? error.message : FAILED_CLOSED;
  const input: HookInput = {
    contract: 2,
    runtime: adapter.id,
    event,
    session: { id: "" },
    cwd: root,
    projectRoot: root,
  };
  return adapter.render(input, { verdict: "deny", reason }).stdout;
}

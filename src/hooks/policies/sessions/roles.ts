import { realSteps } from "../_shared.js";
import { onlyKeys, pass, type Policy } from "../types.js";
import { startsWith } from "./leases.js";

export interface Role {
  readonly name: string;
  readonly agentType: string;
  readonly allowEdits: boolean;
  readonly allowCommands: readonly (readonly string[])[];
}

function readRole(name: string, value: unknown): Role {
  const table = (value ?? {}) as Record<string, unknown>;
  onlyKeys(table, ["agent_type", "allow_edits", "allow_commands"]);
  const agentType = table["agent_type"] ?? name;
  const allowEdits = table["allow_edits"] ?? false;
  const commands = table["allow_commands"] ?? [];
  if (typeof agentType !== "string" || typeof allowEdits !== "boolean") {
    throw new Error(
      `${name}: agent_type must be a string and allow_edits a boolean`,
    );
  }
  const valid =
    Array.isArray(commands) &&
    commands.every(
      (item) =>
        Array.isArray(item) &&
        item.length > 0 &&
        item.every((word) => typeof word === "string"),
    );
  if (!valid)
    throw new Error(`${name}.allow_commands must be a list of argv prefixes`);
  return { name, agentType, allowEdits, allowCommands: commands as string[][] };
}

// Accept plugin-qualified agent names so role rules apply to native plugin agents.
function roleOf(
  roles: readonly Role[],
  agentType: string | undefined,
): Role | undefined {
  if (!agentType) return undefined;
  return roles.find(
    (role) =>
      agentType === role.agentType || agentType.endsWith(`:${role.agentType}`),
  );
}

// Check every classified command so shell chaining cannot bypass role restrictions.
export const roles: Policy<readonly Role[]> = {
  id: "sessions.roles",
  events: ["before_tool"],
  tools: ["shell", "edit"],
  fail: "closed",
  defaultMode: "deny",
  options: (raw) =>
    Object.entries(raw).map(([name, value]) => readRole(name, value)),
  evaluate(input, ctx) {
    const role = roleOf(ctx.options, input.session.agentType);
    const tool = input.tool;
    if (!role || !tool) return pass;
    if (tool.kind === "edit") {
      if (role.allowEdits) return pass;
      return {
        verdict: "deny",
        reason: `The ${role.name} role does not edit files; report back instead.`,
      };
    }
    const steps = tool.steps;
    const allowed =
      steps !== undefined &&
      realSteps(steps).every((step) =>
        role.allowCommands.some((prefix) => startsWith(step.argv, prefix)),
      );
    if (allowed) return pass;
    const list = role.allowCommands
      .map((prefix) => prefix.join(" "))
      .join(", ");
    return {
      verdict: "deny",
      reason: `The ${role.name} role runs only: ${list}. Report back instead.`,
    };
  },
};

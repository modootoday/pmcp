export interface HandoffTask {
  readonly kind: "handoff-task";
  readonly id: string;
  readonly title: string;
  readonly paths: readonly string[];
  readonly verification: readonly string[];
  readonly owner?: string;
  readonly note?: string;
}

export interface HandoffReceipt {
  readonly kind: "handoff-receipt";
  readonly taskId: string;
  readonly status: "done" | "blocked";
  readonly commits: readonly string[];
  readonly verified: readonly string[];
  readonly blocker?: string;
}

export type HandoffPayload = HandoffTask | HandoffReceipt;

const PREFIX = "pmcp-handoff/v1 ";

export function formatHandoff(payload: HandoffPayload): string {
  return `${PREFIX}${JSON.stringify(payload)}`;
}

export function parseHandoff(body: string): HandoffPayload | null {
  const trimmed = body.trim();
  if (!trimmed.startsWith(PREFIX)) return null;
  try {
    const raw = JSON.parse(trimmed.slice(PREFIX.length)) as Record<
      string,
      unknown
    >;
    if (
      raw["kind"] === "handoff-task" &&
      typeof raw["id"] === "string" &&
      typeof raw["title"] === "string" &&
      Array.isArray(raw["paths"]) &&
      Array.isArray(raw["verification"])
    ) {
      return raw as unknown as HandoffTask;
    }
    if (
      raw["kind"] === "handoff-receipt" &&
      typeof raw["taskId"] === "string" &&
      (raw["status"] === "done" || raw["status"] === "blocked") &&
      Array.isArray(raw["commits"]) &&
      Array.isArray(raw["verified"])
    ) {
      return raw as unknown as HandoffReceipt;
    }
    return null;
  } catch {
    return null;
  }
}

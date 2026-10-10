export const containerLabels = {
  owner: "pmcp.harness.owner",
  nonce: "pmcp.harness.nonce",
  role: "pmcp.harness.role",
} as const;

export function containerName(owner: string, sessionId: string): string {
  return `pmcp-harness-${owner.slice(0, 8)}-${sessionId}`;
}

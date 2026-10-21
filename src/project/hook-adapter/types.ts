export type Decision = {
  readonly decision: "allow" | "deny";
  readonly reason?: string;
};

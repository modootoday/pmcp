import { TIERS, type Tier } from "../../schema.js";

export const pairTiers: Record<Tier, readonly Tier[]> = {
  open: [],
  free: ["open"],
  paid: ["open", "free"],
  internal: TIERS,
};
export const namesPattern = (name: string) =>
  new RegExp(
    `(^|[^a-z0-9-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9-]|$)`,
    "u",
  );

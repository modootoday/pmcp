import { expect, it } from "vitest";
import { GUARDS } from "../../src/hooks/policies/index.js";
import { compareIdentifiers } from "../../src/hooks/compile/order.js";

it("preserves the policy order without initializing a locale comparator", () => {
  const ids = Object.keys(GUARDS);
  expect([...ids].sort(compareIdentifiers)).toEqual(
    [...ids].sort((left, right) => left.localeCompare(right, "en")),
  );
  expect(["beta", "alpha-2", "alpha-1"].sort(compareIdentifiers)).toEqual([
    "alpha-1",
    "alpha-2",
    "beta",
  ]);
  expect(compareIdentifiers("same", "same")).toBe(0);
});

import { describe, expect, it } from "vitest";

import { featureSupport } from "../src/project/features/support.js";

const needs = {
  id: "sessions.broadcast",
  events: ["session_start", "before_tool"],
  outputs: ["context"],
  fields: [],
} as unknown as Parameters<typeof featureSupport>[0];

const measurement = (deferred?: Record<string, string>) => ({
  events: { session_start: { fires: true }, before_tool: { fires: true } },
  outputs: {
    context: {
      support: "measured",
      delivered: ["session_start", "after_tool"],
      ...(deferred ? { deferred } : {}),
    },
  },
});

describe("context support counts live-measured deferral", () => {
  it("is unqualified where context is neither delivered nor measured deferred", () => {
    expect(featureSupport(needs, measurement())).toBe("unqualified");
  });

  it("is measured when the held context was seen arriving at a later event", () => {
    const deferred = { before_tool: "after_tool (V2 gemini-context-before)" };
    expect(featureSupport(needs, measurement(deferred))).toBe("measured");
  });
});

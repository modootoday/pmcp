import { expect, it } from "vitest";
import { readOptions } from "../src/harness/observation/options.js";

it("preserves default read options when no input is supplied", () => {
  expect(readOptions()).toEqual({});
  expect(readOptions({})).toEqual({});
});

it("accepts bounded native history and explicit alternate selection", () => {
  expect(
    readOptions({ lines: 2000, maxBytes: 65536, alternate: true }),
  ).toEqual({ lines: 2000, maxBytes: 65536, alternate: true });
  expect(readOptions({ lines: 1, maxBytes: 1, alternate: false })).toEqual({
    lines: 1,
    maxBytes: 1,
    alternate: false,
  });
});

it.each([
  [{ lines: 0 }, "invalid_lines"],
  [{ lines: 2001 }, "invalid_lines"],
  [{ lines: null }, "invalid_lines"],
  [{ maxBytes: 65537 }, "invalid_max_bytes"],
  [{ maxBytes: "256" }, "invalid_max_bytes"],
  [{ alternate: "true" }, "invalid_alternate"],
  [{ alternate: null }, "invalid_alternate"],
  [{ submit: true }, "invalid_read_option"],
])("rejects unsafe or unrelated observation input", (input, error) => {
  expect(() => readOptions(input)).toThrow(error);
});

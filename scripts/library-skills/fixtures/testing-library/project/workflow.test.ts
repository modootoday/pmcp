import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { NameForm } from "./name-form";

afterEach(cleanup);

test("accessible user interaction renders asynchronous success", async () => {
  const user = userEvent.setup();
  const saveName = vi.fn().mockResolvedValue("Saved Ada");
  render(createElement(NameForm, { saveName, dispose: vi.fn() }));
  expect(
    (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await user.type(screen.getByRole("textbox", { name: "Name" }), "Ada");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(saveName).toHaveBeenCalledWith("Ada");
  expect((await screen.findByRole("status")).textContent).toBe("Saved Ada");
});

test("failed save exposes an alert without a success status", async () => {
  const user = userEvent.setup();
  render(
    createElement(NameForm, {
      saveName: vi.fn().mockRejectedValue(new Error("Rejected")),
      dispose: vi.fn(),
    }),
  );
  await user.type(screen.getByRole("textbox", { name: "Name" }), "Ada");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Unable to save");
  expect(screen.queryByRole("status")).toBeNull();
});

test("explicit unmount cleans the effect and removes the accessible form", () => {
  const dispose = vi.fn();
  const { unmount } = render(
    createElement(NameForm, { saveName: vi.fn(), dispose }),
  );
  unmount();
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
});

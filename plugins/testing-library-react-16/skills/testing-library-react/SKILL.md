---
name: testing-library-react
description: Test React components through accessible DOM queries, asynchronous user interactions, visible results and cleanup using React Testing Library 16. Includes DOM Testing Library and user-event integration; use a browser runner for layout and browser-specific behavior.
---

# React Testing Library 16

Read the project's runner, environment and installed peer versions. React Testing
Library 16 works with React 18 or 19 and needs DOM Testing Library 10. The fixture
uses @testing-library/react 16.3.3, @testing-library/dom 10.4.2,
@testing-library/user-event 14.6.7 and matching React/React DOM 19.2.8.
These companion packages have different majors; their versions must not be
inferred from the React Testing Library version.

## Configure the actual environment

Use the application's existing Jest or Vitest runner. React Testing Library does
not require Jest. Set a DOM environment such as jsdom and use the runner's
compatible assertion library. A plain Node import does not create document.

For Vitest with globals disabled, register cleanup explicitly:

```ts
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(cleanup);
```

When the existing runner already supplies automatic cleanup, preserve its single
cleanup owner instead of stacking multiple independent setup systems. Custom
matchers such as toBeInTheDocument need @testing-library/jest-dom configured for
the selected runner; they are not supplied by React Testing Library itself.

## Describe the user-visible contract

Prefer role with accessible name, then labels or text appropriate to the task.
Use a test ID when the semantic surface cannot identify the intended element.
Avoid querying generated classes, component instances or internal state.

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { NameForm } from "./name-form";

test("saves the entered name", async () => {
  const user = userEvent.setup();
  render(<NameForm />);
  await user.type(screen.getByRole("textbox", { name: "Name" }), "Ada");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect((await screen.findByRole("status")).textContent).toBe("Saved Ada");
});
```

This is an application test pattern; NameForm belongs to the consumer application.
The fixture supplies its own bounded component and mocked persistence function.

Use getBy for something already present, queryBy for absence and findBy when it
will appear asynchronously. Scope repeated UI with within rather than choosing an
arbitrary array position. Await user-event interactions; it models event sequences
and interactability more closely than a single fireEvent call. Reserve fireEvent
for the low-level interaction that the chosen test genuinely needs.

## Synchronize and isolate

React Testing Library wraps its renderer operations in act. Prefer awaited user
interactions and asynchronous queries before adding a manual act wrapper. A warning
often indicates unfinished work or a test that stops before the behavior settles.
Use waitFor for a condition, not an arbitrary sleep, and keep side effects outside
its retried callback.

Create userEvent.setup inside each test. When using fake timers, pass the runner's
timer-advancement function through advanceTimers and restore real timers after
the test; setting delay: null can hide an incorrect timer integration.

Unmount components and verify cleanup when the behavior involves subscriptions or
external resources. Mock at the application's actual boundary and exercise a
failure path as well as success. Keep DOM globals local to the chosen test
environment; layout, navigation and browser APIs require a real browser test.

The fixture runs three actual Vitest/jsdom tests: asynchronous save success,
error presentation and effect cleanup on unmount. It does not establish browser
layout, React Native behavior or framework-specific rendering.

## Sources

- [React Testing Library setup](https://testing-library.com/docs/react-testing-library/setup/)
- [DOM query semantics](https://testing-library.com/docs/queries/about/)
- [user-event setup](https://testing-library.com/docs/user-event/setup/)
- [user-event options and timers](https://testing-library.com/docs/user-event/options/)
- [React Testing Library API](https://testing-library.com/docs/react-testing-library/api/)

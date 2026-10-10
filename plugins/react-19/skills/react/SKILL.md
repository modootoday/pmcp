---
name: react
description: Implement and debug React 19 components, state updates, effect cleanup, form actions, transitions and renderer boundaries. Use for React component behavior; select react-dom guidance for browser roots or hydration and the framework's documentation for server integration.
---

# React 19 component behavior

Read the installed React and renderer versions before using version-specific APIs.
Keep react and react-dom on matching versions. The verification fixture targets
the existing React DOM line's 19.2.8 pair; APIs introduced in later minors need
their own compatibility check.

## State, identity and closures

Keep rendering pure. Call hooks at component or custom-hook top level; React's
use API has separate rules and is not a reason to call other hooks conditionally.
State is a snapshot for a render. Use a functional update when the next value
depends on the previous value, particularly in timers or multiple queued updates:

```tsx
import { useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);

  function incrementTwice() {
    setCount((previous) => previous + 1);
    setCount((previous) => previous + 1);
  }

  return <button onClick={incrementTwice}>{count}</button>;
}
```

Replace state objects rather than mutate them. Keys identify sibling instances;
use stable data identifiers rather than positions when items can move. Changing a
key intentionally resets that component's state. Derive values during render
instead of copying props into state or effects unless independent state is needed.

## Synchronize with external systems

An effect connects the component to an external system. Include every reactive
value used by the effect, and mirror setup with cleanup. Development StrictMode
can run setup, cleanup and setup again; do not suppress that cycle with a ref to
hide missing cleanup.

```tsx
import { useEffect } from "react";

export function Connection({ endpoint }: { endpoint: string }) {
  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function connect() {
      try {
        const response = await fetch(endpoint, { signal: controller.signal });
        if (!response.ok) throw new Error(`Request failed: ${response.status}`);
        const result = await response.text();
        if (!active) return;
        console.log(result);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error(error);
      }
    }

    void connect();

    return () => {
      active = false;
      controller.abort();
    };
  }, [endpoint]);

  return null;
}
```

Use the application's query/cache layer when it already owns fetching and
deduplication. An effect example does not replace cache, routing or server data
loading. Use event handlers for user actions rather than an effect triggered by
an artificial state flag.

## Forms and nonurgent updates

useActionState receives the previous state before the action arguments. Validate
FormData at the trust boundary and render the returned state. useFormStatus reads
the status of a parent form, so put the submit-status component inside that form.

```tsx
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button disabled={pending}>Save</button>;
}

export function NameForm() {
  const [message, save] = useActionState(
    async (_previous: string, data: FormData) => {
      const value = data.get("name");
      if (typeof value !== "string" || !value.trim()) return "Enter a name";
      return `Saved ${value.trim()}`;
    },
    "",
  );

  return (
    <form action={save}>
      <input name="name" defaultValue="Ada" />
      <SubmitButton />
      <output>{message}</output>
    </form>
  );
}
```

Function actions reset uncontrolled fields after successful submission. Return
expected validation failures as state; use error boundaries for thrown errors.
Authentication, persistence and Server Action transport remain application or
framework responsibilities.

Transitions mark updates that can yield while urgent interactions proceed. Keep
controlled text-input state urgent. In React 19, state updates after an await may
need another startTransition call; consult the installed-version documentation.
Do not treat useTransition as cancellation or a general request-ordering solution.

## Renderer and server boundaries

Use react-dom/client for browser roots and React Native's renderer for native UI.
Hooks do not run in a standalone element-construction script; exercise state and
effects through a renderer. use can read a cached promise from a compatible
framework or library, not a new promise created during every render. Server
Components and "use server" require framework integration; do not add those
directives to ordinary client modules to create a server endpoint.

For changes to behavior, test a visible state update, cleanup on unmount and the
relevant form/error path. The DOM fixture also checks hydration of matching server
markup; it does not establish browser layout, accessibility or framework SSR.

## Sources

- [State as a snapshot](https://react.dev/learn/state-as-a-snapshot)
- [Queued state updates](https://react.dev/learn/queueing-a-series-of-state-updates)
- [Effects and cleanup](https://react.dev/reference/react/useEffect)
- [React 19 release](https://react.dev/blog/2024/12/05/react-19)
- [useActionState](https://react.dev/reference/react/useActionState)
- [useTransition](https://react.dev/reference/react/useTransition)

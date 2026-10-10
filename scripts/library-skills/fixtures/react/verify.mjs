import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function verify({ scratchRoot }) {
  const dependencyRequire = createRequire(
    join(resolve(scratchRoot), "package.json"),
  );
  const { JSDOM } = dependencyRequire("jsdom");
  const packages = {};
  for (const name of ["react", "react-dom", "jsdom"]) {
    packages[name] = dependencyRequire(`${name}/package.json`).version;
  }
  assert.equal(packages.react, packages["react-dom"]);

  const dom = new JSDOM(
    '<!doctype html><div id="app"></div><div id="form"></div><div id="hydrate"></div>',
    { url: "https://fixture.example/" },
  );
  const keys = [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Event",
    "MouseEvent",
    "FormData",
    "IS_REACT_ACT_ENVIRONMENT",
  ];
  const descriptors = new Map(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const key of keys) {
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[key];
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  }

  const React = dependencyRequire("react");
  const {
    act,
    createElement,
    StrictMode,
    useActionState,
    useEffect,
    useState,
  } = React;
  const { createRoot, hydrateRoot } = dependencyRequire("react-dom/client");
  const { renderToString } = dependencyRequire("react-dom/server");
  const { useFormStatus } = dependencyRequire("react-dom");
  const roots = [];
  let setups = 0;
  let cleanups = 0;
  let actionCalls = 0;

  function Counter() {
    const [count, setCount] = useState(0);
    useEffect(() => {
      setups += 1;
      return () => {
        cleanups += 1;
      };
    }, []);

    function increment() {
      setCount((previous) => previous + 1);
      setCount((previous) => previous + 1);
    }

    return createElement("button", { onClick: increment }, String(count));
  }

  function SubmitButton() {
    const { pending } = useFormStatus();
    return createElement(
      "button",
      { type: "submit", disabled: pending },
      pending ? "Saving" : "Save",
    );
  }

  function NameForm() {
    const [message, save] = useActionState(async (_previous, data) => {
      actionCalls += 1;
      const name = data.get("name");
      if (typeof name !== "string" || !name.trim()) return "Enter a name";
      return `Saved ${name.trim()}`;
    }, "");

    return createElement(
      "form",
      { action: save },
      createElement("input", { name: "name", defaultValue: "Ada" }),
      createElement(SubmitButton),
      createElement("output", null, message),
    );
  }

  try {
    const app = document.getElementById("app");
    const root = createRoot(app);
    roots.push(root);
    await act(async () => {
      root.render(createElement(StrictMode, null, createElement(Counter)));
    });
    assert.equal(app.textContent, "0");
    await act(async () => {
      app
        .querySelector("button")
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    assert.equal(app.textContent, "2");
    await act(async () => root.unmount());
    roots.pop();
    assert.ok(setups >= 1);
    assert.equal(cleanups, setups);
    assert.equal(app.childElementCount, 0);

    const formContainer = document.getElementById("form");
    const formRoot = createRoot(formContainer);
    roots.push(formRoot);
    await act(async () => formRoot.render(createElement(NameForm)));
    await act(async () => {
      formContainer
        .querySelector("form")
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    assert.equal(actionCalls, 1);
    assert.equal(
      formContainer.querySelector("output").textContent,
      "Saved Ada",
    );
    assert.equal(formContainer.querySelector("button").disabled, false);
    await act(async () => {
      formContainer.querySelector("input").value = "";
      formContainer
        .querySelector("form")
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    assert.equal(actionCalls, 2);
    assert.equal(
      formContainer.querySelector("output").textContent,
      "Enter a name",
    );

    const hydrationContainer = document.getElementById("hydrate");
    hydrationContainer.innerHTML = renderToString(createElement(Counter));
    const serverButton = hydrationContainer.firstElementChild;
    const recoverableErrors = [];
    await act(async () => {
      roots.push(
        hydrateRoot(hydrationContainer, createElement(Counter), {
          onRecoverableError(error) {
            recoverableErrors.push(error.message);
          },
        }),
      );
    });
    assert.equal(hydrationContainer.firstElementChild, serverButton);
    assert.deepEqual(recoverableErrors, []);
    await act(async () => {
      serverButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    assert.equal(hydrationContainer.textContent, "2");

    return {
      productId: "react",
      companionProductIds: ["react-dom"],
      packages,
      examplesExecuted: 5,
      checks: [
        "functional queued updates",
        "StrictMode effect cleanup and root unmount",
        "form action success",
        "form action validation",
        "matching hydration and interactive state",
      ],
      sources: {
        "verify.mjs": createHash("sha256")
          .update(await readFile(fileURLToPath(import.meta.url)))
          .digest("hex"),
      },
    };
  } finally {
    for (const root of roots.reverse()) {
      await act(async () => root.unmount());
    }
    for (const [key, descriptor] of descriptors) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
        continue;
      }
      Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const scratchRoot = process.argv[2];
  if (!scratchRoot)
    throw new Error("Pass an isolated dependency workspace path");
  console.log(JSON.stringify(await verify({ scratchRoot })));
}

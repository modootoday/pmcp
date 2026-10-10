import { createElement, useEffect, useState } from "react";

interface NameFormProps {
  saveName: (name: string) => Promise<string>;
  dispose: () => void;
}

export function NameForm({ saveName, dispose }: NameFormProps) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => dispose, [dispose]);

  async function submit(event: { preventDefault(): void }) {
    event.preventDefault();
    setError("");
    try {
      setMessage(await saveName(name));
    } catch {
      setError("Unable to save");
    }
  }

  return createElement(
    "form",
    { onSubmit: submit },
    createElement("label", { htmlFor: "name" }, "Name"),
    createElement("input", {
      id: "name",
      value: name,
      onChange: (event: { target: { value: string } }) =>
        setName(event.target.value),
    }),
    createElement("button", { type: "submit", disabled: !name.trim() }, "Save"),
    message ? createElement("output", { role: "status" }, message) : null,
    error ? createElement("p", { role: "alert" }, error) : null,
  );
}

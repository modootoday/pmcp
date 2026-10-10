import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../style.css";

function Counter() {
  const initial: number = 0;
  const [count, setCount] = useState(initial);
  return (
    <button
      className="grid p-4 bg-accent"
      onClick={() => setCount((value) => value + 1)}
    >
      {import.meta.env.VITE_PUBLIC_LABEL}: {count}
    </button>
  );
}

const container = document.getElementById("app");
if (!container) throw new Error("Missing app container");
createRoot(container).render(<Counter />);

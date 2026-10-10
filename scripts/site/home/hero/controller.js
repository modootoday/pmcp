export function mountHero(root) {
  const canvas = root.querySelector("canvas");
  const abort = new AbortController();
  let scene = null;
  let loading = false;
  let active = true;

  async function load() {
    if (loading || !active) return;
    loading = true;
    try {
      const { createHeroScene } = await import("./scene.js");
      if (!active) return;
      scene = createHeroScene(canvas);
      scene.visible(true);
      root.dataset.graphics = "ready";
    } catch {
      root.dataset.graphics = "fallback";
    }
  }

  const observer = new IntersectionObserver(
    ([entry]) => {
      scene?.visible(entry.isIntersecting);
      if (entry.isIntersecting) void load();
    },
    { rootMargin: "100px" },
  );
  observer.observe(root);
  root
    .querySelector(".hero-workspace-stage")
    .addEventListener("pointerenter", () => scene?.pulse(), {
      signal: abort.signal,
    });
  for (const button of root.querySelectorAll("[data-runtime]"))
    button.addEventListener("click", () => scene?.pulse(), {
      signal: abort.signal,
    });
  canvas.addEventListener(
    "webglcontextlost",
    (event) => {
      event.preventDefault();
      scene?.dispose();
      scene = null;
      root.dataset.graphics = "fallback";
    },
    { signal: abort.signal },
  );
  window.addEventListener(
    "pagehide",
    () => {
      active = false;
      observer.disconnect();
      abort.abort();
      scene?.dispose();
    },
    { once: true },
  );
}

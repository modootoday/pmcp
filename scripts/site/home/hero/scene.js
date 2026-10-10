import {
  Group,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import { createWorkspace } from "./geometry.js";

export function createHeroScene(canvas) {
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  const camera = new OrthographicCamera(0, 640, 0, 448, 0.1, 2000);
  camera.position.z = 1000;
  const scene = new Scene();
  const root = new Group();
  scene.add(root);
  const resources = new Set();
  const keep = (resource) => {
    resources.add(resource);
    return resource;
  };
  const paths = createWorkspace(root, keep);
  const packetGeometry = keep(new SphereGeometry(3.5, 12, 8));
  const packetMaterial = keep(new MeshBasicMaterial({ color: 0xffdfac }));
  const packets = paths.slice(0, 2).map(() => {
    const mesh = new Mesh(packetGeometry, packetMaterial);
    mesh.visible = false;
    root.add(mesh);
    return mesh;
  });
  const point = new Vector3();
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;
  let started = null;
  let visible = false;
  let destroyed = false;
  let lastDraw = 0;

  function draw(now = performance.now()) {
    frame = 0;
    if (destroyed) return;
    if (started !== null && now - lastDraw < 33) {
      frame = requestAnimationFrame(draw);
      return;
    }
    lastDraw = now;
    const progress = started === null ? 1 : Math.min(1, (now - started) / 1800);
    for (const [index, packet] of packets.entries()) {
      packet.visible = progress < 1;
      const path = paths[index];
      const segment = Math.min(
        path.length - 2,
        Math.floor(progress * (path.length - 1)),
      );
      const fraction = progress * (path.length - 1) - segment;
      point.copy(path[segment]).lerp(path[segment + 1], fraction);
      packet.position.copy(point);
      packet.position.z = 3;
    }
    if (progress === 1) started = null;
    renderer.render(scene, camera);
    if (visible && !document.hidden && started !== null && !reduced.matches)
      frame = requestAnimationFrame(draw);
  }

  function resize() {
    if (canvas.clientWidth < 1 || canvas.clientHeight < 1) return;
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    draw();
  }

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    started = null;
    if (visible && !document.hidden) draw();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  document.addEventListener("visibilitychange", stop);
  reduced.addEventListener("change", stop);
  resize();

  return {
    pulse() {
      if (reduced.matches || !visible || document.hidden || destroyed) return;
      cancelAnimationFrame(frame);
      started = performance.now();
      draw();
    },
    visible(value) {
      visible = value;
      stop();
    },
    dispose() {
      destroyed = true;
      stop();
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", stop);
      reduced.removeEventListener("change", stop);
      for (const resource of resources) resource.dispose();
      renderer.dispose();
    },
  };
}

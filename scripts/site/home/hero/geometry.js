import {
  BufferGeometry,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from "three";
import { platform, routes } from "./model.js";

function polygon(points, color, keep) {
  const geometry = keep(new BufferGeometry());
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(points.flat(), 3),
  );
  geometry.setIndex([0, 2, 1, 0, 3, 2]);
  return new Mesh(geometry, keep(new MeshBasicMaterial({ color })));
}

function line(points, material, keep) {
  const geometry = keep(new BufferGeometry().setFromPoints(points));
  const mesh = new Line(geometry, keep(material));
  mesh.computeLineDistances();
  return mesh;
}

export function createWorkspace(root, keep) {
  const top = platform.map(([x, y]) => [x, y, -1]);
  root.add(polygon(top, 0x1b2128, keep));
  for (const [a, b] of [
    [platform[0], platform[3]],
    [platform[3], platform[2]],
  ]) {
    root.add(
      polygon(
        [
          [a[0], a[1], -2],
          [b[0], b[1], -2],
          [b[0], b[1] + 17, -2],
          [a[0], a[1] + 17, -2],
        ],
        0x151b20,
        keep,
      ),
    );
  }
  root.add(
    line(
      [...platform, platform[0]].map(([x, y]) => new Vector3(x, y, 0)),
      new LineBasicMaterial({ color: 0x42494e }),
      keep,
    ),
  );
  const paths = routes.map((points) =>
    points.map(([x, y]) => new Vector3(x, y, 1)),
  );
  for (const points of paths) {
    root.add(
      line(
        points,
        new LineDashedMaterial({
          color: 0xe3b676,
          dashSize: 6,
          gapSize: 5,
          transparent: true,
          opacity: 0.85,
        }),
        keep,
      ),
    );
  }
  return paths;
}

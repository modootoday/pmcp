import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { artifact } from "../process/artifact.js";
import { bridgeName } from "./entrypoint.js";
import type { DockerCreation } from "./creation-plan.js";

function source(): Buffer {
  const path = artifact("egress-bridge");
  if (!path.endsWith(".js"))
    throw new Error("docker_bridge_requires_compiled_cli");
  return readFileSync(path);
}

function digest(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function bridgeDigest(): string {
  return digest(source());
}

export function prepareBridge(creation: DockerCreation): void {
  if (!creation.egress?.bridgeExecutable) return;
  const content = source();
  if (digest(content) !== creation.bridgeSha256)
    throw new Error("docker_bridge_source_changed");
  const descriptor = openSync(
    join(creation.state, bridgeName(creation.nonce)),
    "wx",
    0o600,
  );
  try {
    writeFileSync(descriptor, content);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function assertBridge(creation: DockerCreation): void {
  if (!creation.egress?.bridgeExecutable) return;
  const descriptor = openSync(
    join(creation.state, bridgeName(creation.nonce)),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const stat = fstatSync(descriptor);
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid?.() ||
      stat.nlink !== 1 ||
      (stat.mode & 0o077) !== 0 ||
      stat.size > 2_097_152 ||
      digest(readFileSync(descriptor)) !== creation.bridgeSha256
    )
      throw new Error("docker_bridge_artifact_changed");
  } finally {
    closeSync(descriptor);
  }
}

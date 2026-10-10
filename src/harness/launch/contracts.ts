import type { DockerResource, SessionRecord } from "../contracts.js";
import type { DockerCreation } from "../adapters/docker/creation-plan.js";

export interface LaunchIntent {
  id: string;
  owner: string;
  controllerIdentity: string;
  groupId: string;
  generation: string;
  role: "main" | "worker";
  nonce: string;
  unit: string;
  slice: string;
  socket: string;
  runtime: string;
  memoryMb: number;
  argv: string[];
  cwd: string;
  createdAt: string;
  resource?: DockerResource;
  dockerCreation?: DockerCreation;
}

export interface LaunchProof {
  session: SessionRecord;
  runnerIdentity: string;
  nonce: string;
}

export interface LaunchGrant {
  id: string;
  owner: string;
  groupId: string;
  generation: string;
  nonce: string;
  proofDigest: string;
}

export interface AbortRecord {
  id: string;
  owner: string;
  state: "stopping" | "stopped";
}

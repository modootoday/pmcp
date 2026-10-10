import { createHash } from "node:crypto";

export interface DigestResult {
  algorithm: "sha256";
  value: string;
}

export function digest(value: string): DigestResult {
  return {
    algorithm: "sha256",
    value: createHash("sha256").update(value).digest("hex"),
  };
}

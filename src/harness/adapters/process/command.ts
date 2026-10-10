import {
  execFileSync,
  type ExecFileSyncOptionsWithStringEncoding,
} from "node:child_process";

export function command(
  binary: string,
  args: string[],
  options: Partial<ExecFileSyncOptionsWithStringEncoding> = {},
): string {
  return execFileSync(binary, args, {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 256 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
    ...options,
  });
}

export function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

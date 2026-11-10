import { randomFillSync } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  openSync,
  read,
  write,
  writeSync,
} from "node:fs";
import { performance } from "node:perf_hooks";

import type { IoModel } from "./model.js";

// O_DIRECT probes on a file, never a raw device. Direct IO needs buffers aligned to the logical
// block size; WebAssembly memory is page aligned, which Buffer.alloc does not promise.

const BLOCK = 4096;
const MIB = 1 << 20;
const WASM_PAGE = 65536;

interface Wasm {
  Memory: new (descriptor: { initial: number }) => { buffer: ArrayBuffer };
}

export function alignedBuffer(size: number): Buffer {
  const { Memory } = (globalThis as unknown as { WebAssembly: Wasm })
    .WebAssembly;
  const memory = new Memory({ initial: Math.ceil(size / WASM_PAGE) });
  return Buffer.from(memory.buffer, 0, size);
}

function direct(): number {
  const flag = (constants as Record<string, number>)["O_DIRECT"];
  if (flag === undefined) throw new Error("O_DIRECT is not available here");
  return flag;
}

function openDirect(path: string, flags: number, mode?: number): number {
  try {
    return openSync(path, flags | direct(), mode);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EINVAL")
      throw new Error(
        `${path}: this filesystem refuses O_DIRECT; give --dir on a disk-backed filesystem`,
      );
    throw error;
  }
}

export interface Rate {
  readonly ops: number;
  readonly seconds: number;
  readonly iops: number;
  readonly bps: number;
}

// Sequential 1 MiB writes that make the probe file; fsync is inside the timing.
export function makeFile(path: string, sizeMb: number): Rate {
  const fd = openDirect(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC,
    0o600,
  );
  try {
    const buffer = alignedBuffer(MIB);
    randomFillSync(buffer);
    const begun = performance.now();
    for (let at = 0; at < sizeMb; at += 1) writeSync(fd, buffer, 0, MIB);
    fsyncSync(fd);
    const seconds = (performance.now() - begun) / 1000;
    return rate(sizeMb, MIB, seconds);
  } finally {
    closeSync(fd);
  }
}

function rate(ops: number, size: number, seconds: number): Rate {
  return {
    ops,
    seconds: Math.round(seconds * 100) / 100,
    iops: Math.floor(ops / seconds),
    bps: Math.floor((ops * size) / seconds),
  };
}

export interface Pattern {
  readonly depth: number;
  readonly size: number;
  readonly write: boolean;
  readonly sequential: boolean;
}

function io(fd: number, buffer: Buffer, offset: number, writing: boolean) {
  return new Promise<void>((resolve, reject) => {
    const done = (error: Error | null, bytes: number) => {
      if (error) return reject(error);
      if (bytes !== buffer.length)
        return reject(new Error(`short ${writing ? "write" : "read"}`));
      resolve();
    };
    if (writing) write(fd, buffer, 0, buffer.length, offset, done);
    else read(fd, buffer, 0, buffer.length, offset, done);
  });
}

// depth concurrent loops, each on its own aligned slice; the caller sizes the libuv pool to match.
export async function runPattern(
  path: string,
  seconds: number,
  pattern: Pattern,
): Promise<Rate> {
  const flags = pattern.write ? constants.O_RDWR : constants.O_RDONLY;
  const fd = openDirect(path, flags);
  try {
    const blocks = Math.floor(fstatSync(fd).size / pattern.size);
    const per = Math.floor(blocks / pattern.depth);
    if (per < 1) throw new Error(`${path} is too small for the probe`);
    const memory = alignedBuffer(pattern.size * pattern.depth);
    if (pattern.write) randomFillSync(memory);
    const deadline = performance.now() + seconds * 1000;
    let ops = 0;
    const loop = async (lane: number) => {
      const buffer = memory.subarray(
        lane * pattern.size,
        (lane + 1) * pattern.size,
      );
      let position = lane * per;
      while (performance.now() < deadline) {
        let block: number;
        if (pattern.sequential) {
          block = position;
          position =
            position + 1 >= (lane + 1) * per ? lane * per : position + 1;
        } else block = Math.floor(Math.random() * blocks);
        await io(fd, buffer, block * pattern.size, pattern.write);
        ops += 1;
      }
    };
    const begun = performance.now();
    await Promise.all(
      Array.from({ length: pattern.depth }, (_, lane) => loop(lane)),
    );
    const elapsed = (performance.now() - begun) / 1000;
    if (pattern.write) fsyncSync(fd);
    return rate(ops, pattern.size, elapsed);
  } finally {
    closeSync(fd);
  }
}

export const DEPTH = 16;

export const PATTERNS: Readonly<Record<string, Pattern>> = {
  rseq_1m_qd4: { depth: 4, size: MIB, write: false, sequential: true },
  rseq_4k_qd16: { depth: DEPTH, size: BLOCK, write: false, sequential: true },
  rrand_4k_qd16: { depth: DEPTH, size: BLOCK, write: false, sequential: false },
  wseq_4k_qd16: { depth: DEPTH, size: BLOCK, write: true, sequential: true },
  wrand_4k_qd16: { depth: DEPTH, size: BLOCK, write: true, sequential: false },
};

export interface Probes {
  readonly wseq_1m_file: Rate;
  readonly [name: string]: Rate;
}

export async function probeAll(
  path: string,
  sizeMb: number,
  seconds: number,
): Promise<Probes> {
  const made = makeFile(path, sizeMb);
  const found: Record<string, Rate> = { wseq_1m_file: made };
  for (const [name, pattern] of Object.entries(PATTERNS))
    found[name] = await runPattern(path, seconds, pattern);
  return found as Probes;
}

// The same mapping the measured baseline used: 1 MiB reads and the file write give the byte
// rates, 4 KiB at depth 16 the per-operation costs.
export function modelOf(probes: Readonly<Record<string, Rate>>): IoModel {
  const take = (name: string, key: "bps" | "iops") => {
    const value = probes[name]?.[key];
    if (value === undefined || value < 1)
      throw new Error(`the ${name} probe gave no ${key}`);
    return value;
  };
  return {
    rbps: take("rseq_1m_qd4", "bps"),
    rseqiops: take("rseq_4k_qd16", "iops"),
    rrandiops: take("rrand_4k_qd16", "iops"),
    wbps: take("wseq_1m_file", "bps"),
    wseqiops: take("wseq_4k_qd16", "iops"),
    wrandiops: take("wrand_4k_qd16", "iops"),
  };
}

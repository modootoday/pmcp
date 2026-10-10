import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

const maximumSize = 32 * 1024 * 1024;

export function integrity(bytes) {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

function safePath(path) {
  if (
    !/^package\//u.test(path) ||
    path.includes("\\") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Unsafe archive path");
}

function octal(header, offset, width, value) {
  const text = value.toString(8).padStart(width - 1, "0");
  if (text.length >= width)
    throw new Error("Archive numeric field is too large");
  header.write(`${text}\0`, offset, width, "ascii");
}

export function createArchive(files) {
  const chunks = [];
  let size = 0;
  for (const [path, bytes] of [...files].sort(([a], [b]) =>
    Buffer.compare(Buffer.from(a), Buffer.from(b)),
  )) {
    safePath(path);
    if (Buffer.byteLength(path) > 100)
      throw new Error("Archive path exceeds the portable tar limit");
    const header = Buffer.alloc(512);
    header.write(path, 0, "utf8");
    octal(header, 100, 8, 0o644);
    octal(header, 108, 8, 0);
    octal(header, 116, 8, 0);
    octal(header, 124, 12, bytes.length);
    octal(header, 136, 12, 0);
    header.fill(32, 148, 156);
    header[156] = 48;
    header.write("ustar\0", 257, "ascii");
    header.write("00", 263, "ascii");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
    const padding = Buffer.alloc((512 - (bytes.length % 512)) % 512);
    size += header.length + bytes.length + padding.length;
    if (size > maximumSize)
      throw new Error("Archive exceeds the supported size");
    chunks.push(header, bytes, padding);
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks), { level: 9 });
}

export function readArchive(bytes) {
  const tar = gunzipSync(bytes, { maxOutputLength: maximumSize });
  const files = new Map();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const string = (start, length) =>
      header
        .subarray(start, start + length)
        .toString("utf8")
        .replace(/\0.*$/su, "");
    const name = string(0, 100);
    const prefix = string(345, 155);
    const path = prefix ? `${prefix}/${name}` : name;
    safePath(path);
    if (header[156] !== 0 && header[156] !== 48)
      throw new Error("Archive contains a non-regular file");
    const expected = Number.parseInt(string(148, 8).trim(), 8);
    const actual = header.reduce(
      (sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte),
      0,
    );
    if (expected !== actual)
      throw new Error("Archive header checksum mismatch");
    const size = Number.parseInt(string(124, 12).trim(), 8);
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      offset + 512 + size > tar.length
    )
      throw new Error("Archive member is truncated");
    if (files.has(path)) throw new Error("Archive contains duplicate members");
    files.set(path, tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (!files.size) throw new Error("Archive contains no files");
  return files;
}

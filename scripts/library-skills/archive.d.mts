export function integrity(bytes: Buffer): string;
export function createArchive(files: Map<string, Buffer>): Buffer;
export function readArchive(bytes: Buffer): Map<string, Buffer>;

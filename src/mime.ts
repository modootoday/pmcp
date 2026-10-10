/**
 * One MIME table for every surface that hands out skill files, so a file is text,
 * image, audio or blob the same way through skill_read and through resources/read.
 */

const TYPES: Readonly<Record<string, string>> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".json": "application/json",
  ".jsonl": "application/jsonl",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".toml": "application/toml",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".xml": "application/xml",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".cjs": "text/javascript",
  ".jsx": "text/javascript",
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".mts": "text/typescript",
  ".cts": "text/typescript",
  ".py": "text/x-python",
  ".rb": "text/x-ruby",
  ".go": "text/x-go",
  ".rs": "text/x-rust",
  ".java": "text/x-java",
  ".sh": "text/x-shellscript",
  ".bash": "text/x-shellscript",
  ".zsh": "text/x-shellscript",
  ".ps1": "text/x-powershell",
  ".sql": "application/sql",
  ".ejs": "text/x-ejs",
  ".hbs": "text/x-handlebars-template",
  ".mustache": "text/x-mustache",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".tar": "application/x-tar",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const TEXT_APPLICATION = new Set([
  "application/json",
  "application/jsonl",
  "application/toml",
  "application/xml",
  "application/sql",
  "image/svg+xml",
]);

/** The declared type of a path by extension, or null when the extension is unknown. */
export function mimeOf(path: string): string | null {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  if (dot === -1 || dot < slash) return null;
  return TYPES[path.slice(dot).toLowerCase()] ?? null;
}

/** True when the bytes decode as UTF-8 and encode back to themselves, without NUL. */
export function isUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export type FileKind = "text" | "image" | "audio" | "blob";

export interface Classified {
  readonly kind: FileKind;
  readonly mimeType: string;
}

/**
 * How a file goes out. A type that names text is still served as a blob when the
 * bytes are not valid UTF-8, so a digest over them stays exact.
 */
export function classify(path: string, bytes: Uint8Array): Classified {
  const declared = mimeOf(path);
  const textual =
    declared === null
      ? isUtf8Text(bytes)
      : declared.startsWith("text/") || TEXT_APPLICATION.has(declared);
  if (textual && isUtf8Text(bytes)) {
    return { kind: "text", mimeType: declared ?? "text/plain" };
  }
  if (declared?.startsWith("image/") && declared !== "image/svg+xml") {
    return { kind: "image", mimeType: declared };
  }
  if (declared?.startsWith("audio/"))
    return { kind: "audio", mimeType: declared };
  return { kind: "blob", mimeType: declared ?? "application/octet-stream" };
}

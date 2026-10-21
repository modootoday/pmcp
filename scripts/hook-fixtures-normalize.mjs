#!/usr/bin/env node
// Usage: node scripts/hook-fixtures-normalize.mjs [--replace FROM=TO]... [--date YYYY-MM-DD]
//   [--map FILE] FILE.json...  Rewrites recorded hook payloads in place so a fixture keeps the
// runtime's shape and nothing of the recording machine; --map writes the real ids, keep it private.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu;
const IS_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
// Runtime ids with a prefix (Claude toolu_, Codex call_, OpenCode ses_/evt_/msg_/prt_/tool_);
// the digit lookahead keeps field names such as tool_response out.
const PREFIXED =
  /\b(toolu|call|ses|evt|msg|prt|tool|part)_(?=[A-Za-z]*\d)[A-Za-z0-9]{8,}/gu;
const DATE = /\b(20\d\d)-(\d\d)-(\d\d)(?=[T _"]|$)/gmu;
// Codex keeps its transcripts under sessions/YYYY/MM/DD/.
const SLASH_DATE = /\b(20\d\d)\/(\d\d)\/(\d\d)(?=\/)/gu;
const EPOCH_MS = /\b1\d{12}\b/gu;
const PROCESS_ID = /\b(PGID|PID|pid)(["']?\s*[:=]\s*)(\d{3,})\b/gu;
const DAY = 86_400_000;
// Recorded days map onto 2000-01-01 onward, so order and time of day survive and the day does not.
const TARGET = Date.UTC(2000, 0, 1);

function parseArgs(argv) {
  const pairs = [];
  const files = [];
  let map;
  let date;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--replace") {
      const [from, ...rest] = (argv[++i] ?? "").split("=");
      if (!from || rest.length === 0)
        throw new Error("--replace needs FROM=TO");
      pairs.push([from, rest.join("=")]);
    } else if (arg === "--map") map = argv[++i];
    else if (arg === "--date") date = argv[++i];
    else files.push(arg);
  }
  if (files.length === 0) throw new Error("no fixture files given");
  return { pairs, files, map, date };
}

// A path also appears URL-encoded (grok session dirs) and as a dashed slug (Claude project dirs).
function variants([from, to]) {
  const slug = (path) => path.replace(/[/.]/gu, "-");
  return [
    [from, to],
    [encodeURIComponent(from), encodeURIComponent(to)],
    [slug(from), slug(to)],
  ];
}

// Only dates and epoch values within 60 days of the recording day move; others are content.
function shifter(date) {
  if (!date) return { date: (d) => d, epoch: (n) => n };
  const base = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(base)) throw new Error(`--date ${date} is not YYYY-MM-DD`);
  const near = (ms) => Math.abs(ms - base) <= 60 * DAY;
  const shift = base - TARGET;
  return {
    date(text, y, m, d) {
      const ms = Date.UTC(Number(y), Number(m) - 1, Number(d));
      return near(ms) ? new Date(ms - shift).toISOString().slice(0, 10) : text;
    },
    epoch(text) {
      const ms = Number(text);
      return near(ms) ? String(ms - shift) : text;
    },
  };
}

// Placeholders sit outside /home and /Users, where any user name would read as a real machine.
export function normalizer(pairs, options = {}) {
  const { home = homedir(), host = hostname(), date } = options;
  const replacements = [...pairs, [home, "/rec/home"]]
    .flatMap(variants)
    .sort((a, b) => b[0].length - a[0].length);
  const when = shifter(date);
  const ids = new Map();
  const counters = new Map();
  const next = (prefix, width) => {
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    return `${prefix}${String(n).padStart(width, "0")}`;
  };
  const stable = (old, make) => {
    if (!ids.has(old)) ids.set(old, make());
    return ids.get(old);
  };
  const uuid = (old) =>
    stable(old.toLowerCase(), () => {
      const n = next("uuid", 12).slice(4);
      return `00000000-0000-4000-8000-${n}`;
    });
  return {
    ids,
    apply(text) {
      let out = text;
      for (const [from, to] of replacements) out = out.split(from).join(to);
      if (host) out = out.split(host).join("host");
      out = out.replace(UUID, uuid);
      out = out.replace(PREFIXED, (old, prefix) =>
        stable(old, () => next(`${prefix}_`, 8)),
      );
      // A short form of a session id (the first 8 hex digits, as in some transcript names).
      for (const [old, now] of ids) {
        if (!IS_UUID.test(old)) continue;
        const short = new RegExp(
          `(?<![0-9a-f])${old.slice(0, 8)}(?![0-9a-f])`,
          "gu",
        );
        out = out.replace(short, now.slice(-8));
      }
      out = out.replace(DATE, when.date).replace(EPOCH_MS, when.epoch);
      out = out.replace(SLASH_DATE, (text, y, m, d) =>
        when.date(text, y, m, d).replaceAll("-", "/"),
      );
      return out.replace(PROCESS_ID, (_m, name, sep) => `${name}${sep}4242`);
    },
  };
}

function main() {
  const { pairs, files, map, date } = parseArgs(process.argv.slice(2));
  const n = normalizer(pairs, { date });
  for (const file of [...files].sort()) {
    const before = readFileSync(file, "utf8");
    const after = n.apply(before);
    JSON.parse(after);
    if (after !== before) writeFileSync(file, after);
  }
  if (map)
    writeFileSync(
      map,
      `${JSON.stringify(Object.fromEntries(n.ids), null, 2)}\n`,
    );
  console.log(`normalised ${files.length} file(s), ${n.ids.size} id(s)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();

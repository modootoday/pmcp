---
name: croner
description: Use Croner 10.x (^10.0.0, documented at 10.0.1) to calculate, match, schedule, and control cron jobs in plain JavaScript/TypeScript scripts.
---

Verified against croner@10.0.1 on 2026-09-07. 4 of 4 examples executed.

# croner

## Scope and version

This skill targets Croner 10.x, specifically the documented 10.0.1 line. It is a library, not a separate runner or CLI: import `Cron` and use it from your program. Documented runtime targets include Node.js >=18, Deno >=2, Bun >=1, and browsers.

## Import correctly

Use the named export and instantiate it with `new`:

```ts
import { Cron } from "croner";
```

CommonJS uses:

```ts
const { Cron } = require("croner");
```

Do not use `import Cron from "croner"`; the default export was removed in v9. Do not omit `new`.

## Constructing jobs

The constructor accepts a cron pattern, a JavaScript `Date`, or an ISO 8601 string as its first argument. A `Date` or ISO string creates a one-shot job. The second argument is optional options, and the third is an optional callback:

```ts
const job = new Cron("* * * * * *", { maxRuns: 1 }, () => {
  // called by the schedule
});
```

A callback can instead be supplied as the second argument:

```ts
const job = new Cron("*/5 * * * * *", () => {
  // every fifth second
});
```

Jobs schedule immediately unless `{ paused: true }` is supplied. Use `paused: true` when constructing a job for inspection or when you intend to start it explicitly.

## Calculation and enumeration

These methods calculate dates without waiting for timers:

- `nextRun(startFromDate?)` returns a `Date`.
- `nextRuns(count, startFromDate?)` returns scheduled `Date[]`.
- `previousRuns(count, referenceDate?)` returns scheduled `Date[]`.
- `previousRun()` returns the previous scheduled date.
- `msToNext(startFromDate?)` returns milliseconds until the next execution.
- `currentRun()` returns the current run information exposed by the job.

```ts pmcp-example
import { Cron } from "croner";
import assert from "node:assert/strict";

const job = new Cron("0 0 0 * * 7", { paused: true });
const from = new Date("2025-01-01T00:00:00Z");
const runs = job.nextRuns(2, from);

assert.equal(runs.length, 2);
assert.ok(runs[0] instanceof Date);
assert.ok(runs[1] > runs[0]);
assert.ok(job.nextRun(from) instanceof Date);
assert.ok(job.msToNext(from) >= 0);
assert.equal(job.previousRuns(1, from).length, 1);
```

## Matching dates

`match(date)` checks whether a `Date` or date string satisfies the pattern. This was added in 10.0.0.

```ts pmcp-example
import { Cron } from "croner";
import assert from "node:assert/strict";

const monday = new Cron("0 0 0 * * MON", { paused: true });
assert.equal(monday.match("2024-01-01T00:00:00"), true);
assert.equal(monday.match("2024-01-02T00:00:00"), false);
assert.equal(monday.match(new Date("2024-01-01T00:00:00")), true);
```

## One-shot dates and time zones

An ISO local time can be interpreted in a specified IANA time zone:

```ts
const job = new Cron("2024-01-23T00:00:00", {
  timezone: "Asia/Kolkata",
  paused: true,
});
```

The `timezone` option supports names such as `Europe/Stockholm`. `getOnce()` returns the original one-shot value as a `Date`, represented in the runtime’s date format; compare its timestamp or ISO representation rather than comparing it with the original string.

```ts pmcp-example
import { Cron } from "croner";
import assert from "node:assert/strict";

const job = new Cron("2030-01-23T00:00:00", {
  timezone: "Asia/Kolkata",
  paused: true,
});

assert.ok(job.getOnce() instanceof Date);
assert.equal(job.getOnce()?.toISOString(), "2030-01-22T18:30:00.000Z");
assert.ok(job.nextRun() instanceof Date);
```

## Triggering and controlling a job

The control methods are `trigger()`, `pause()`, `resume()`, and `stop()`. Status methods include `isRunning()`, `isStopped()`, and `isBusy()`.

`stop()` is permanent: a stopped job cannot be resumed. It also removes a named job from the exported `scheduledJobs` array. The documented import examples show `Cron`; do not assume the named-jobs array is available from the same documented import shape without checking the installed package.

```ts pmcp-example
import { Cron } from "croner";
import assert from "node:assert/strict";

let calls = 0;
const job = new Cron("* * * * * *", { paused: true }, () => {
  calls += 1;
});

assert.equal(job.isRunning(), false);
assert.equal(job.isStopped(), false);
assert.equal(job.isBusy(), false);
assert.equal(job.getPattern(), "* * * * * *");
assert.equal(job.getOnce(), null);

job.trigger();
assert.equal(calls, 1);
job.pause();
job.resume();
job.stop();
assert.equal(job.isStopped(), true);
```

The callback-based scheduling API requires the host runtime to remain alive for timer execution. `unref` is documented for Node.js and Deno, not browsers.

## 10.x syntax and options

10.x adds an optional seventh year field, `W` for nearest weekday, and `+` for explicit day-of-month AND day-of-week logic. Examples include:

```ts
new Cron("0 12 * * * * 2025", { paused: true });
new Cron("0 12 15W * *", { paused: true });
new Cron("0 12 15 * +FRI", { paused: true });
```

`?` is now a wildcard alias for `*`; it no longer has the older behavior of replacing fields with current-time values.

Use `domAndDow` rather than deprecated `legacyMode`: `domAndDow: false` is OR logic (the default), while `domAndDow: true` is AND logic.

Strict stepping is now the default. Forms such as `*/10`, `0-59/10`, and `30-50/10` are valid; legacy forms `/10`, `0/10`, and `30/30` require `{ sloppyRanges: true }`.

Other documented 10.x options include `dayOffset`, `mode`, and `alternativeWeekdays`. `mode` can be `"auto"`, `"5-part"`, `"6-part"`, `"7-part"`, `"5-or-6-parts"`, or `"6-or-7-parts"`.

## Migration traps

Code copied from older majors commonly uses names that no longer exist:

- `next()` became `nextRun()`.
- `enumerate()` became `nextRuns()`.
- `current()` became `currentRun()`.
- `previous()` became `previousRun()`.
- `running()` became `isRunning()`.
- `busy()` became `isBusy()`.

Also account for the v9 removal of the default export and optional `new`.

## Not covered

This skill does not cover undocumented exports such as the exact shape or import path of `scheduledJobs`, callback argument/context details, browser bundler configuration, or behavior requiring a long-lived timer run. It also does not cover package-specific CLI or runner usage because the research documents none.

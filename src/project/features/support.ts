import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { RuntimeId } from "../../hooks/contract.js";
import type { Support } from "../../hooks/runtimes/types.js";
import type { FeatureNeeds } from "./catalog.js";

interface Measurement {
  readonly version?: string;
  readonly events?: Record<string, { fires?: unknown }>;
  readonly outputs?: Record<
    string,
    { support?: unknown; delivered?: unknown; deferred?: unknown }
  >;
  readonly fields_absent?: readonly string[];
}

const RANK: Readonly<Record<Support, number>> = {
  unsupported: 0,
  unqualified: 1,
  measured: 2,
};

// Locate measurements beside both source and distribution so runtime diagnostics share the same evidence.
function measurementFile(runtime: RuntimeId): string | null {
  const candidates = [
    "../docs/hooks/capabilities/",
    "../../../docs/hooks/capabilities/",
  ].map((base) =>
    fileURLToPath(new URL(`${base}${runtime}.json`, import.meta.url)),
  );
  return candidates.find((file) => existsSync(file)) ?? null;
}

export function readMeasurement(runtime: RuntimeId): Measurement | null {
  const file = measurementFile(runtime);
  if (!file) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Measurement;
  } catch {
    return null;
  }
}

function eventSupport(measurement: Measurement, event: string): Support {
  const fires = measurement.events?.[event]?.fires;
  if (fires === true) return "measured";
  if (typeof fires === "string") return "unqualified";
  return "unsupported";
}

function outputSupport(
  measurement: Measurement,
  output: string,
  event: string,
): Support {
  const entry = measurement.outputs?.[output];
  const value = entry?.support;
  if (value === "unsupported") return "unsupported";
  if (value !== "measured") return "unqualified";
  const delivered = entry?.delivered;
  // A deferred event's context was measured live arriving at a later delivering event.
  const deferred = (entry?.deferred ?? {}) as Record<string, unknown>;
  if (
    Array.isArray(delivered) &&
    !delivered.includes(event) &&
    !Object.hasOwn(deferred, event)
  )
    return "unqualified";
  return "measured";
}

export function featureSupport(
  needs: FeatureNeeds,
  measurement: Measurement | null,
): Support {
  if (!measurement) return "unqualified";
  const absent = measurement.fields_absent ?? [];
  const parts: Support[] = [
    ...needs.events.map((event) => eventSupport(measurement, event)),
    ...needs.outputs.flatMap((output) =>
      needs.events.map((event) => outputSupport(measurement, output, event)),
    ),
    ...needs.fields.map((field): Support =>
      absent.some((entry) => entry.startsWith(field))
        ? "unsupported"
        : "unqualified",
    ),
  ];
  return parts.reduce<Support>(
    (worst, part) => (RANK[part] < RANK[worst] ? part : worst),
    "measured",
  );
}

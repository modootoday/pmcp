import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { LOCK_FILE, POLICY_FILE, sha256 } from "../hooks/compiled.js";
import { RUNTIME_IDS, type RuntimeId } from "../hooks/contract.js";
import { RUNTIMES } from "../hooks/runtimes/index.js";
import { featureCatalog, type FeatureNeeds } from "./features/catalog.js";
import { featureSupport, readMeasurement } from "./features/support.js";
import { codexTrust, codexTrustKeys } from "./features/trust.js";
import type { ProjectSpec } from "./spec.js";

export interface FeatureRow {
  readonly feature: string;
  readonly enabled: "toml" | "auto" | "default-off";
  readonly projected: "yes" | "drift" | "no" | "-";
  readonly claude: string;
  readonly codex: string;
  readonly codexTrust: string;
  // Support per runtime; claude and codex above repeat their cells for older readers.
  readonly cells: Readonly<Record<RuntimeId, string>>;
}

function onDisk(root: string): { text: string; locked: boolean } | null {
  const file = join(root, POLICY_FILE);
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  // A lock that is not JSON verifies nothing; doctor reports it beside the outputs check.
  let lock: { outputs?: { path: string; sha256?: string }[] } = {};
  try {
    if (existsSync(join(root, LOCK_FILE)))
      lock = JSON.parse(readFileSync(join(root, LOCK_FILE), "utf8")) as {
        outputs?: { path: string; sha256?: string }[];
      };
  } catch {
    lock = {};
  }
  const entry = lock.outputs?.find((output) => output.path === POLICY_FILE);
  return { text, locked: entry?.sha256 === sha256(text) };
}

function nativeEvents(needs: FeatureNeeds): string[] {
  return needs.events.flatMap(
    (event) => RUNTIMES.codex.nativeEvent(event) ?? [],
  );
}

function enabledSource(
  on: boolean,
  source: string | undefined,
): FeatureRow["enabled"] {
  if (!on) return "default-off";
  return source === "auto" ? "auto" : "toml";
}

function projectionState(
  on: boolean,
  disk: ReturnType<typeof onDisk>,
  expected: string,
): FeatureRow["projected"] {
  if (!on) return "-";
  if (!disk) return "no";
  return disk.text === expected && disk.locked ? "yes" : "drift";
}

export function featureRows(
  spec: ProjectSpec,
  options: { home: string; env: Readonly<Record<string, string | undefined>> },
): FeatureRow[] {
  const policy = spec.hookBundle?.policy ?? null;
  const expected = policy ? `${JSON.stringify(policy, null, 2)}\n` : "";
  const disk = onDisk(spec.root);
  const keys = codexTrustKeys(options.home, options.env);
  const measurements = Object.fromEntries(
    RUNTIME_IDS.map((id) => [id, readMeasurement(id)]),
  ) as Record<RuntimeId, ReturnType<typeof readMeasurement>>;
  const active = new Set([
    ...(policy?.guards ?? []).map((guard) => guard.id),
    ...(policy?.custom ?? []).map((entry) => `custom.${entry.name}`),
  ]);
  return featureCatalog(policy).map((needs) => {
    const on = active.has(needs.id);
    const source = spec.featureSources?.[needs.id];
    const enabled = enabledSource(on, source);
    const projected = projectionState(on, disk, expected);
    const cell = (runtime: RuntimeId) => {
      if (!on || !policy?.targets.includes(runtime)) return "-";
      const support = featureSupport(needs, measurements[runtime]);
      const lowered =
        policy.lowering[runtime] && needs.outputs.includes("ask")
          ? ` (ask->${policy.lowering[runtime]!.ask})`
          : "";
      return `${support}${lowered}`;
    };
    const trust =
      on && policy?.targets.includes("codex")
        ? codexTrust(spec.root, nativeEvents(needs), keys)
        : "-";
    const cells = Object.fromEntries(
      RUNTIME_IDS.map((id) => [id, cell(id)]),
    ) as Record<RuntimeId, string>;
    return {
      feature: needs.id,
      enabled,
      projected,
      claude: cells.claude,
      codex: cells.codex,
      codexTrust: trust,
      cells,
    };
  });
}

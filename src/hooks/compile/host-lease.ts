import { DISABLE_ENV, readLeaseSettings } from "../../lease/config.js";
import type { CompiledGuard } from "../compiled.js";
import { FEATURES } from "../policies/index.js";

// Off unless [host.lease] lists heavy commands; a disabled lease guards nothing either.
export function readHostLease(
  host: unknown,
  root: string,
): CompiledGuard | null {
  if (host === undefined) return null;
  const settings = readLeaseSettings("pmcp.toml", root, host);
  if (!settings.enabled || settings.guard === "off") return null;
  if (settings.heavy.length === 0) return null;
  const options = {
    heavy: settings.heavy,
    skip_env: [
      DISABLE_ENV,
      ...(settings.legacySkipEnv ? [settings.legacySkipEnv] : []),
    ],
  };
  FEATURES["host.lease"]!.options(options);
  return { id: "host.lease", mode: settings.guard, options };
}

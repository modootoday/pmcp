import type { Command } from "../cli/command.js";
import { invocation } from "../cli/invocation.js";
import { loginSpec, logoutSpec, whoamiSpec } from "./specs/session.js";
import {
  clearSession,
  discover,
  pollOnce,
  readSession,
  revoke,
  startDevice,
  writeSession,
  type Fetcher,
} from "../remote/session.js";

// Keep sign-in in the CLI so reading installed skills requires neither credentials nor network access.
const DEFAULT_ISSUER = "https://auth.pmcp.build";
const DEFAULT_CLIENT = "https://auth.pmcp.build/oauth-client.json";
const DEFAULT_RESOURCE = "https://api.pmcp.build";
const DEFAULT_SCOPE = "pmcp:catalog:read pmcp:distribution:read";

const fetcher: Fetcher = (url, init) =>
  fetch(url, init as RequestInit) as unknown as ReturnType<Fetcher>;

const setting = (
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: string,
): string => env[name] ?? fallback;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const loginCommand: Command = {
  ...loginSpec,

  async run({ ui, args, env }) {
    const issuer =
      args.options.get("issuer")?.[0] ??
      setting(env, "PMCP_AUTH_ISSUER", DEFAULT_ISSUER);
    const clientId = setting(env, "PMCP_OAUTH_CLIENT_ID", DEFAULT_CLIENT);
    const resource = setting(env, "PMCP_OAUTH_RESOURCE", DEFAULT_RESOURCE);
    const scope = setting(env, "PMCP_OAUTH_SCOPE", DEFAULT_SCOPE);

    let metadata;
    try {
      metadata = await discover(issuer, fetcher);
    } catch (error) {
      ui.error("cannot sign in", (error as Error).message);
      return 1;
    }

    let start;
    try {
      start = await startDevice(
        metadata,
        { clientId, resource, scope },
        fetcher,
      );
    } catch (error) {
      ui.error("cannot start sign-in", (error as Error).message);
      return 1;
    }

    // Print a portable code because the terminal may run on a host without an attended browser.
    ui.info("open", start.verificationUriComplete ?? start.verificationUri);
    ui.info("code", start.userCode);
    ui.line();
    ui.info("waiting", "approve it and this finishes on its own");

    let interval = start.intervalMs;
    for (;;) {
      if (Date.now() >= start.expiresAt) {
        ui.error(
          "expired",
          `the code timed out; run ${invocation()} login again`,
        );
        return 1;
      }
      await wait(interval);
      const outcome = await pollOnce(
        metadata,
        { clientId, deviceCode: start.deviceCode, issuer },
        fetcher,
      );
      if (outcome.kind === "granted" && outcome.session) {
        writeSession(outcome.session);
        ui.success("signed in", issuer);
        return 0;
      }
      // Honor slower polling requests to avoid provider rate limits.
      if (outcome.kind === "slow_down") interval += 5000;
      if (outcome.kind === "denied") {
        ui.error("declined", "the request was not approved");
        return 1;
      }
      if (outcome.kind === "expired") {
        ui.error(
          "expired",
          `the code timed out; run ${invocation()} login again`,
        );
        return 1;
      }
    }
  },
};

export const logoutCommand: Command = {
  ...logoutSpec,

  async run({ ui, env }) {
    const session = readSession();
    if (!session) {
      ui.info("not signed in", "nothing to forget");
      return 0;
    }
    const clientId = setting(env, "PMCP_OAUTH_CLIENT_ID", DEFAULT_CLIENT);
    // Clear local credentials first so a revocation outage cannot undo local logout.
    clearSession();
    try {
      const metadata = await discover(session.issuer, fetcher);
      const revoked = await revoke(metadata, session, clientId, fetcher);
      ui.success(
        "signed out",
        revoked ? "token revoked" : "local copy removed",
      );
    } catch {
      ui.success("signed out", "local copy removed");
    }
    return 0;
  },
};

export const whoamiCommand: Command = {
  ...whoamiSpec,

  run({ ui, args }) {
    const session = readSession();
    // Write status data to stdout so callers can pipe the answer.
    if (!session) {
      if (args.flags.has("json")) {
        ui.data(`${JSON.stringify({ signedIn: false }, null, 2)}\n`);
      } else {
        ui.data("not signed in\n");
        ui.info("sign in", `run ${invocation()} login`);
      }
      return 1;
    }
    const left =
      session.expiresAt === undefined
        ? undefined
        : session.expiresAt - Date.now();
    // Report credential presence without exposing its value.
    const answer = {
      signedIn: true,
      issuer: session.issuer,
      ...(session.scope === undefined ? {} : { scope: session.scope }),
      ...(left === undefined
        ? {}
        : { expiresInMinutes: Math.max(0, Math.floor(left / 60000)) }),
    };
    if (args.flags.has("json")) {
      ui.data(`${JSON.stringify(answer, null, 2)}\n`);
      return 0;
    }
    ui.data(`issuer ${answer.issuer}\n`);
    if (answer.scope !== undefined) ui.data(`scope ${answer.scope}\n`);
    if (left !== undefined) {
      ui.data(
        left > 0
          ? `token valid for ${String(answer.expiresInMinutes)} min\n`
          : `token expired, run ${invocation()} login\n`,
      );
    }
    return 0;
  },
};

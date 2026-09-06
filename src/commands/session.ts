import type { Command } from "../cli/command.js";
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

/**
 * Signing in is optional and only the CLI does it. Reading the skills a project
 * already has never touches the network, so the MCP server the host spawns has
 * no credential, no issuer and no fetch. What signing in unlocks is obtaining
 * skills the project does not have yet.
 */
const DEFAULT_ISSUER = "https://auth.pmcp.build";
const DEFAULT_CLIENT = "https://auth.pmcp.build/oauth-client.json";
const DEFAULT_RESOURCE = "https://api.pmcp.build";
const DEFAULT_SCOPE = "catalog:read distribution:read";

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
  name: "login",
  describe: "Sign in on this machine, to obtain skills this project lacks",
  usage: "pmcp login [--issuer <url>]",
  options: [
    {
      name: "issuer",
      describe: "override the auth issuer",
      placeholder: "<url>",
    },
  ],

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

    // No browser is opened. This terminal may be on a machine nobody is
    // looking at, and the code is short enough to carry to one that is.
    ui.info("open", start.verificationUriComplete ?? start.verificationUri);
    ui.info("code", start.userCode);
    ui.line();
    ui.info("waiting", "approve it and this finishes on its own");

    let interval = start.intervalMs;
    for (;;) {
      if (Date.now() >= start.expiresAt) {
        ui.error("expired", "the code timed out; run pmcp login again");
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
      // The server asks for a slower cadence by name, and ignoring it is how a
      // client gets rate limited into failing.
      if (outcome.kind === "slow_down") interval += 5000;
      if (outcome.kind === "denied") {
        ui.error("declined", "the request was not approved");
        return 1;
      }
      if (outcome.kind === "expired") {
        ui.error("expired", "the code timed out; run pmcp login again");
        return 1;
      }
    }
  },
};

export const logoutCommand: Command = {
  name: "logout",
  describe: "Forget the sign-in on this machine",
  usage: "pmcp logout",

  async run({ ui, env }) {
    const session = readSession();
    if (!session) {
      ui.info("not signed in", "nothing to forget");
      return 0;
    }
    const clientId = setting(env, "PMCP_OAUTH_CLIENT_ID", DEFAULT_CLIENT);
    // The local copy goes first. If revocation fails the token is still gone
    // from this machine, which is what the person asked for.
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
  name: "whoami",
  describe: "Whether this machine is signed in, and to what",
  usage: "pmcp whoami",

  run({ ui }) {
    const session = readSession();
    if (!session) {
      ui.info("not signed in", "run pmcp login");
      return 1;
    }
    ui.info("issuer", session.issuer);
    if (session.scope) ui.info("scope", session.scope);
    if (session.expiresAt !== undefined) {
      const left = session.expiresAt - Date.now();
      ui.info(
        "token",
        left > 0
          ? `valid for ${String(Math.floor(left / 60000))} min`
          : "expired, run pmcp login",
      );
    }
    // The token itself is never printed. Knowing it is present is the answer.
    return 0;
  },
};

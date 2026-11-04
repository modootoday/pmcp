import type { CommandSpec } from "../../cli/command.js";

export const loginSpec: CommandSpec = {
  name: "login",
  examples: ["pmcp login"],
  describe: "Sign in on this machine, to obtain skills this project lacks",
  usage: "pmcp login [--issuer <url>]",
  options: [
    {
      name: "issuer",
      describe: "override the auth issuer",
      placeholder: "<url>",
    },
  ],
};

export const logoutSpec: CommandSpec = {
  name: "logout",
  examples: ["pmcp logout"],
  describe: "Forget the sign-in on this machine",
  usage: "pmcp logout",
};

export const whoamiSpec: CommandSpec = {
  name: "whoami",
  examples: ["pmcp whoami", "pmcp whoami --json"],
  describe: "Whether this machine is signed in, and to what",
  usage: "pmcp whoami [--json]",
  options: [
    {
      name: "json",
      describe: "Print the result as one JSON envelope on stdout.",
      boolean: true,
    },
  ],
};

// What [host.lease] heavy = "default" names: the install, test, build and typecheck commands of
// the common package managers, as argv prefixes the host.lease guard expects under the lease.

const SCRIPTS = ["test", "build", "typecheck"];

function scripts(manager: string, direct: readonly string[]): string[][] {
  return [
    ...direct.map((verb) => [manager, verb]),
    ...SCRIPTS.map((script) => [manager, "run", script]),
  ];
}

export const DEFAULT_HEAVY: readonly (readonly string[])[] = [
  ["npm", "install"],
  ["npm", "i"],
  ["npm", "ci"],
  ["npm", "test"],
  ...scripts("npm", []),
  ["pnpm", "install"],
  ["pnpm", "i"],
  ...scripts("pnpm", SCRIPTS),
  ["yarn", "install"],
  ...scripts("yarn", SCRIPTS),
  ["bun", "install"],
  ["bun", "i"],
  ["bun", "test"],
  ...scripts("bun", []),
  ["cargo", "build"],
  ["cargo", "test"],
  ["cargo", "check"],
];

export const HEAVY_PRESET = "default";

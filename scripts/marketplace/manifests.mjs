const repository = "https://github.com/modootoday/pmcp";
const nativeBridgeVersion = "0.13.1";

export function pluginManifests(descriptor) {
  const identity = {
    name: descriptor.id,
    version: descriptor.version,
    description: descriptor.description,
    author: { name: "modootoday" },
    license: "Elastic-2.0",
    repository,
    homepage: "https://pmcp.build/skills/",
  };
  const mcpServers = descriptor.bridge
    ? {
        pmcp: {
          type: "stdio",
          command: "npx",
          args: ["-y", `@modootoday/pmcp@${nativeBridgeVersion}`, "serve"],
        },
      }
    : {};
  const files = new Map([
    [
      "plugin.json",
      {
        $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
        ...identity,
      },
    ],
    [".claude-plugin/plugin.json", identity],
    [
      "gemini-extension.json",
      {
        name: descriptor.id,
        version: descriptor.version,
        ...(descriptor.bridge ? { mcpServers } : {}),
      },
    ],
  ]);
  if (descriptor.bridge) {
    files.set("mcp.json", {
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers,
    });
    files.set(".mcp.json", { mcpServers });
  }
  return files;
}

export function marketplaceManifests(descriptors) {
  const plugins = descriptors.map((item) => ({
    name: item.id,
    version: item.version,
    description: item.description,
    source: `./plugins/${item.id}`,
  }));
  return new Map([
    [
      ".claude-plugin/marketplace.json",
      {
        name: "pmcp",
        owner: { name: "modootoday" },
        metadata: {
          description: "Free public library skills and the PMCP native bridge.",
        },
        plugins,
      },
    ],
    [
      ".agents/plugins/marketplace.json",
      {
        name: "pmcp",
        interface: { displayName: "PMCP" },
        plugins: plugins.map((plugin) => ({
          ...plugin,
          source: { source: "local", path: plugin.source },
          policy: { installation: "AVAILABLE", authentication: "ON_USE" },
          category: "Developer Tools",
        })),
      },
    ],
  ]);
}

export function apiContractConfiguration() {
  return {
    name: "vite-plugin-api-contract-fixture",
    enforce: "post",
    apply: "serve",
    config(config) {
      config.optimizeDeps = {
        ...config.optimizeDeps,
        noDiscovery: true,
        include: [],
      };
    },
  };
}

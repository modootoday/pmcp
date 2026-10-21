export interface PluginDescriptor {
  id: string;
  version: string;
  description: string;
  bridge: boolean;
  mod?: boolean;
}
export const MOD_HOOKS: string;
export function pluginManifests(
  descriptor: PluginDescriptor,
  options?: { withMod?: boolean },
): Map<string, Record<string, unknown>>;

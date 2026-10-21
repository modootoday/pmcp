export interface Rejection {
  readonly path: string;
  readonly reason: string;
}
export interface PluginManifest {
  readonly description?: string;
  readonly hooks?: unknown;
}
export interface Context {
  readonly marketplace: string;
  readonly plugin: string;
  readonly pluginDir: string;
  readonly pluginDescription: string | undefined;
  readonly tier: string | undefined;
  readonly onReject: ((rejection: Rejection) => void) | undefined;
}

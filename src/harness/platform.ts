// pmcp harness, pmcp tui and pmcp-pty run on Linux and macOS (crates/pmcp-plugin-support/src/
// platform.rs says the same for the binaries). Elsewhere they stop with this reason instead of
// running with weaker process control or access checks.
export function unsupportedHost(
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (platform === "linux" || platform === "darwin") return undefined;
  if (platform === "win32")
    return "Windows is not supported yet: pmcp harness, pmcp tui and pmcp-pty run on Linux and macOS";
  return `${platform} is not supported yet: pmcp harness, pmcp tui and pmcp-pty run on Linux and macOS`;
}

export function unsupportedReceipt(hint: string) {
  return {
    schemaVersion: 1,
    ok: false,
    error: "platform_unsupported",
    hint,
    resendAllowed: false,
  };
}

export interface PipeEnd {
  on(event: "error", listener: (error: NodeJS.ErrnoException) => void): unknown;
}

// A reader that stops early (pmcp list | head -1) has what it asked for; end quietly as the
// shell's SIGPIPE would, with exit 0 instead of a stack trace. Other write errors stay loud.
export function endQuietlyOnClosedPipe(
  streams: readonly PipeEnd[],
  exit: (code: number) => void = (code) => process.exit(code),
): void {
  for (const stream of streams)
    stream.on("error", (error) => {
      if (error.code === "EPIPE") return exit(0);
      throw error;
    });
}

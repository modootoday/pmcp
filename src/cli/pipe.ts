export interface PipeEnd {
  on(event: "error", listener: (error: NodeJS.ErrnoException) => void): unknown;
}

let holders = 0;

// A wrapped job outlives a reader that stopped (a caller's deadline closes the pipes): the
// job's own exit code answers for the run, so a closed pipe must not end it with 0.
export function holdOnClosedPipe(): () => void {
  holders += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
  };
}

// A reader that stops early (pmcp list | head -1) has what it asked for; end quietly as the
// shell's SIGPIPE would, with exit 0 instead of a stack trace. Other write errors stay loud.
export function endQuietlyOnClosedPipe(
  streams: readonly PipeEnd[],
  exit: (code: number) => void = (code) => process.exit(code),
): void {
  for (const stream of streams)
    stream.on("error", (error) => {
      if (error.code !== "EPIPE") throw error;
      if (holders > 0) return;
      exit(0);
    });
}

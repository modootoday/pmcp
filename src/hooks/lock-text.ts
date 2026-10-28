// Why pmcp.lock cannot be read, and how to put it back. Shared by the hook entry, projection and
// doctor; kept free of dependencies because the hook bundle loads it.

const MARKER = /^(?:<{7}|={7}|>{7})(?: |$)/mu;

export function lockProblem(text: string): string {
  const at = text.split("\n").findIndex((line) => MARKER.test(line));
  const what =
    at >= 0
      ? `pmcp.lock holds git conflict markers (line ${at + 1})`
      : "pmcp.lock is not valid JSON";
  return `${what}; restore it with git checkout <rev> -- pmcp.lock or git show <rev>:pmcp.lock > pmcp.lock, then run pmcp project`;
}

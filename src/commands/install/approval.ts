import { createInterface } from "node:readline/promises";
import { ArgumentError, type CommandContext } from "../../cli/command.js";

export async function approve(context: CommandContext): Promise<boolean> {
  if (
    !process.stdin.isTTY ||
    !process.stderr.isTTY ||
    context.args.flags.has("json")
  ) {
    throw new ArgumentError(
      "use --yes to apply non-interactively or --dry-run to inspect the plan",
    );
  }
  const prompt = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    const answer = await prompt.question(
      "Update this project's dependencies and lockfile? [y/N] ",
    );
    if (!/^y(?:es)?$/iu.test(answer.trim())) {
      context.ui.info("cancelled", "nothing written");
      return false;
    }
  } finally {
    prompt.close();
  }
  return true;
}

import { createInterface } from "node:readline/promises";

export interface RuntimePrompt {
  question(message: string): Promise<string>;
}

export async function chooseRuntime(
  prompt: RuntimePrompt,
  choices: readonly string[],
  preferred: string,
): Promise<string | undefined> {
  if (!choices.length) throw new Error("runtime_executable_unavailable");
  const fallback = Math.max(choices.indexOf(preferred), 0);
  process.stderr.write(
    `${choices.map((runtime, index) => `${index + 1}. ${runtime}`).join("\n")}\n`,
  );
  while (true) {
    const answer = (
      await prompt.question(
        `Runtime [1-${choices.length}, Enter=${fallback + 1}, q=cancel] `,
      )
    ).trim();
    if (answer === "q") return undefined;
    if (answer === "") return choices[fallback];
    if (!/^\d+$/.test(answer)) continue;
    const index = Number(answer) - 1;
    if (Number.isSafeInteger(index) && index >= 0 && index < choices.length)
      return choices[index];
  }
}

export async function confirmRuntimeStart(
  prompt: RuntimePrompt,
  runtime: string,
): Promise<boolean> {
  const answer = await prompt.question(
    `Start ${runtime}? [Enter=start, q=cancel] `,
  );
  return answer.trim() === "";
}

export function terminalPrompt() {
  return createInterface({ input: process.stdin, output: process.stderr });
}

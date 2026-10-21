import { STATE_PATHS } from "./reader/index";
import { refresh } from "./snapshot";
import { PANE_ID, state } from "./state";

async function writeState($: any, name: string, value: object): Promise<void> {
  const dir = state.stateDir;
  await $.process.run(["mkdir", "-p", dir]);
  await $.fs.write(`${dir}/${name}`, `${JSON.stringify(value, null, 2)}\n`);
}

async function removeState($: any, name: string): Promise<void> {
  await $.process.run(["rm", "-f", `${state.stateDir}/${name}`]);
}

async function togglePane($: any): Promise<{ text: string }> {
  if (!state.settings?.sessionsPane)
    return { text: "The sessions pane is off in [ui.claude]." };
  if (state.isOpen) {
    await $.ui.close({ id: PANE_ID });
    state.isOpen = false;
    await refresh($);
    return { text: "Sessions pane closed." };
  }
  await $.ui.open({ id: PANE_ID, title: "Sessions" });
  state.isOpen = true;
  await refresh($);
  return { text: `${state.snapshot.records.length} live session(s).` };
}

export async function runCommand(
  $: any,
  args: string,
): Promise<{ text: string }> {
  if (!state.settings) return { text: "The pmcp mod has not started yet." };
  const [verb = "", ...words] = args.trim().split(/\s+/);
  const since = new Date().toISOString();
  if (verb === "pause") {
    const reason = words.join(" ");
    if (!reason) return { text: "Usage: /pmcp pause <reason>" };
    await writeState($, STATE_PATHS.pause, { by: state.self, reason, since });
    await refresh($);
    return {
      text: `Paused: ${reason}. Other sessions' edits and mutating commands are refused until /pmcp resume.`,
    };
  }
  if (verb === "resume") {
    await removeState($, STATE_PATHS.pause);
    await refresh($);
    return { text: "Resumed." };
  }
  if (verb === "broadcast") {
    const text = words.join(" ");
    if (!text) return { text: "Usage: /pmcp broadcast <text>" };
    const id = `${Date.now()}`;
    await writeState($, STATE_PATHS.broadcast, {
      id,
      by: state.self,
      text,
      since,
    });
    await refresh($);
    return {
      text: "Broadcast sent; every other session sees it at its next prompt.",
    };
  }
  if (verb === "unbroadcast") {
    await removeState($, STATE_PATHS.broadcast);
    await refresh($);
    return { text: "Broadcast cleared." };
  }
  return togglePane($);
}

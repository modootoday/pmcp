import { ArgumentError, type Command } from "../cli/command.js";
import { REMOTE_OPTIONS, remoteCatalog } from "./remote-options.js";

/**
 * What a skill contains, before paying for it.
 *
 * A summary sentence cannot carry the decision, because what is being sold is
 * the writing. This shows the contents and one complete example, taken from the
 * skill's own bytes rather than described, so the sample cannot drift from the
 * thing it samples.
 */
export const previewCommand: Command = {
  name: "preview",
  describe: "Show what a skill contains before subscribing",
  usage: "pmcp preview <skill-package> [--json]",
  options: [
    ...REMOTE_OPTIONS,
    { name: "json", describe: "Print the preview as JSON.", boolean: true },
  ],

  async run(context) {
    const [requested, ...extra] = context.args.positional;
    if (!requested || extra.length) {
      throw new ArgumentError("name one skill package to preview");
    }
    const catalog = await remoteCatalog(context);
    const entry = catalog.entries.find(
      (candidate) =>
        candidate.delivery.packageName === requested ||
        candidate.productId === requested,
    );
    if (!entry) {
      context.ui.error("no such skill", requested);
      return 1;
    }

    if (context.args.flags.has("json")) {
      context.ui.data(
        `${JSON.stringify(
          {
            productId: entry.productId,
            title: entry.title,
            summary: entry.summary,
            package: `${entry.delivery.packageName}@${entry.delivery.version}`,
            evidence: entry.evidence,
            targets: entry.targets,
            preview: entry.preview,
          },
          null,
          2,
        )}\n`,
      );
      return 0;
    }

    context.ui.data(`${entry.title}\n\n${entry.summary}\n\n`);
    context.ui.data(
      `${entry.evidence.examplesExecuted} examples executed on ${entry.evidence.verifiedOn}, against ${entry.targets
        .map((target) => `${target.packageName}@${target.verifiedVersions.join(", ")}`)
        .join("; ")}\n\n`,
    );
    if (entry.preview.headings.length > 0) {
      context.ui.data("Contents\n");
      for (const heading of entry.preview.headings) {
        context.ui.data(`  ${heading}\n`);
      }
      context.ui.data("\n");
    }
    // The sample is a real example from the skill, assertions included: a
    // reader can run it and see for themselves.
    context.ui.data(`One example from this skill\n\n${entry.preview.example}\n`);
    return 0;
  },
};

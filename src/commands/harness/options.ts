import type { OptionSpec } from "../../cli/command.js";

export const harnessOptions: readonly OptionSpec[] = [
  {
    name: "include-starts",
    describe: "Include pending native starts in recovery inspection",
    boolean: true,
  },
  {
    name: "columns",
    describe: "Terminal width in cells",
    placeholder: "<integer>",
  },
  {
    name: "rows",
    describe: "Terminal height including status",
    placeholder: "<integer>",
  },
  {
    name: "generation",
    describe: "Expected group generation for a mutation",
    placeholder: "<id>",
  },
  {
    name: "group-file",
    describe: "Private owned group state",
    placeholder: "<file>",
  },
  {
    name: "input",
    describe: "Group, session, read or watch specification JSON",
    placeholder: "<file>",
  },
  { name: "session", describe: "Owned native session ID", placeholder: "<id>" },
  {
    name: "lease-file",
    describe: "Private writer credential",
    placeholder: "<file>",
  },
  {
    name: "controller",
    describe: "Local controller identity",
    placeholder: "<id>",
  },
  {
    name: "mode",
    describe: "Control cli/native; attachment observe/write",
    placeholder: "<mode>",
  },
  {
    name: "request-id",
    describe: "Explicit input idempotency key",
    placeholder: "<id>",
  },
  {
    name: "text-file",
    describe: "Literal single-line UTF-8 input without submission",
    placeholder: "<file>",
  },
];

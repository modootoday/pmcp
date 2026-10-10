import { z } from "zod";

const Count = z.string().regex(/^\d+$/).transform(Number);
const input: z.input<typeof Count> = "12";
const output: z.output<typeof Count> = Count.parse(input);

// @ts-expect-error Transform output is numeric.
const wrongOutput: z.output<typeof Count> = "12";
// @ts-expect-error Transform input is a string.
const wrongInput: z.input<typeof Count> = 12;

export { input, output, wrongOutput, wrongInput };

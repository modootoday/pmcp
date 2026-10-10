import { scale } from "@pmcp-fixture/typed-library";
import type { ScaleOptions } from "@pmcp-fixture/typed-library";

const options = { factor: 3 } satisfies ScaleOptions;
const result: number = scale(4, options);

export { result };

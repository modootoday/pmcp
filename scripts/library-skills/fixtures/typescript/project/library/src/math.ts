export interface ScaleOptions {
  factor: number;
}

export function scale(value: number, options: ScaleOptions): number {
  return value * options.factor;
}

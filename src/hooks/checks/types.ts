export interface AfterEditOptions {
  readonly validatorGlob: string;
  readonly command: readonly string[];
  readonly debounceMs: number;
}

export interface StopOptions {
  readonly projectCheck: boolean;
}

export interface CheckState {
  readonly validators: Readonly<Record<string, number>>;
  readonly edited: boolean;
  readonly stopTurn?: string;
  readonly pending: readonly string[];
  readonly projectorReported?: boolean;
}

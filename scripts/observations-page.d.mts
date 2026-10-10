/** The site builders are plain scripts; this is what the tests may call. */
export interface LedgerObservation {
  readonly stage: string;
  readonly code: string;
  readonly evidence: string;
}

export interface LedgerExamination {
  readonly id: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly versionExact: boolean;
  readonly examinedAt: string;
  readonly policyDigest: string;
  readonly policyDescriptor: string;
  readonly examplesRun: number;
  readonly outcome: string;
  readonly observations: readonly LedgerObservation[];
}

export interface Ledger {
  readonly disclaimer: string;
  readonly examinations: readonly LedgerExamination[];
}

export declare const MEANS: Record<string, string>;
export declare const PACKAGE_STAGES: ReadonlySet<string>;
export declare function stageTag(stage: string): string;
export declare function renderLedger(ledger: Ledger): string;

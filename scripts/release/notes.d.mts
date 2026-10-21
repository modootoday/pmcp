export interface ReleaseCommit {
  sha: string;
  subject: string;
  type: string | null;
  scope: string | null;
  text: string;
  breaking: boolean;
  footer: string | undefined;
  conventional: boolean;
}

export function previousTag(
  to: string,
  published: readonly string[],
  cwd: string,
): string | undefined;

export function commits(
  from: string | undefined,
  to: string,
  cwd: string,
): ReleaseCommit[];

export function notes(options: {
  to: string;
  published: readonly string[];
  repo: string;
  cwd: string;
  summary?: boolean;
}): { from: string | undefined; text: string };

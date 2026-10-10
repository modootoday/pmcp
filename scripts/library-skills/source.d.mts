export function sourceDigest(source: string): string;
export function contentDigest(name: string, source: string): string;
export function parseSkill(source: string): {
  name: string;
  description: string;
  body: string;
};
export function readSkillFiles(directory: string): {
  source: string;
  skill: ReturnType<typeof parseSkill>;
  files: Map<string, Buffer>;
};

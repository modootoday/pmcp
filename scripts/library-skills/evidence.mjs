import semver from "semver";
import { sourceDigest } from "./source.mjs";

export function verifyEvidence(evidence, entry, source) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(evidence?.verifiedOn ?? "") ||
    !Array.isArray(evidence.fixtures) ||
    !evidence.fixtures.length
  )
    throw new Error("Executed fixture evidence is required");
  const day = new Date(`${evidence.verifiedOn}T00:00:00Z`);
  if (
    !Number.isFinite(day.getTime()) ||
    day.toISOString().slice(0, 10) !== evidence.verifiedOn
  )
    throw new Error("Invalid fixture verification date");
  const digest = sourceDigest(source);
  for (const fixture of evidence.fixtures) {
    if (
      fixture.exitCode !== 0 ||
      !Number.isSafeInteger(fixture.checks) ||
      fixture.checks < 1 ||
      typeof fixture.command !== "string" ||
      !fixture.command.trim() ||
      fixture.skillSha256 !== digest
    )
      throw new Error(
        "Fixture evidence must record successful executed checks for this skill source",
      );
    const target = entry.targets.find(
      (value) => value.packageName === fixture.targetPackage,
    );
    if (!target?.verifiedVersions.includes(fixture.version))
      throw new Error("Fixture evidence names an unselected target version");
  }
  for (const target of entry.targets) {
    for (const version of target.verifiedVersions) {
      if (!semver.valid(version) || !semver.satisfies(version, target.range))
        throw new Error("Invalid verified target version");
      if (
        !evidence.fixtures.some(
          (fixture) =>
            fixture.targetPackage === target.packageName &&
            fixture.version === version,
        )
      )
        throw new Error(
          "Verified target version has no executed fixture evidence",
        );
    }
  }
  return {
    verifiedOn: evidence.verifiedOn,
    examplesExecuted: evidence.fixtures.reduce(
      (sum, fixture) => sum + fixture.checks,
      0,
    ),
  };
}

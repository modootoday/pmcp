#!/usr/bin/env bash
# After a failed publish job: which of the release's packages are on npm, and how to recover.
# Writes to the job summary; the draft release is left in place.
set -uo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
release="$(node -p 'require(process.argv[1]).version' "$root/package.json")"
names="$(node -p 'Object.keys(JSON.parse(process.argv[1])).join("\n")' \
  "$(node "$root/scripts/platform-packages.mjs" --optional-dependencies)")"
summary="${GITHUB_STEP_SUMMARY:-/dev/stdout}"

{
  echo "## Release ${RELEASE_TAG:-v$release} did not finish"
  echo
  echo "| Package | On npm |"
  echo "| --- | --- |"
  for name in $names @modootoday/pmcp; do
    if [ "$(npm view "$name@$release" version 2>/dev/null)" = "$release" ]; then
      echo "| \`$name@$release\` | yes |"
    else
      echo "| \`$name@$release\` | no |"
    fi
  done
  echo
  echo "The draft release is kept. Platform packages publish first and the main package last, so"
  echo "a partial publish leaves nothing that installs a missing platform package."
  echo
  echo "- Transient failure (registry, OIDC, network): \`gh run rerun ${GITHUB_RUN_ID:-<run id>} --failed\`,"
  echo "  then approve the npm environment again. Packages already on npm are skipped."
  echo "- A fix that needs a code or workflow change: never move or reuse the tag; fix on main and"
  echo "  release the next patch version."
} >> "$summary"

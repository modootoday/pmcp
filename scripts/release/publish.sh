#!/usr/bin/env bash
# Publishes the packed release (MODE=publish) or rehearses it with npm publish --dry-run on the
# same paths (any other MODE), so a broken publish fails before a tag. Platform packages go first
# and the main package last; a version already on npm is skipped, which makes a rerun safe.
set -euo pipefail

dir="${1:-./packed}"
# npm reads a bare "packed/x.tgz" as a GitHub owner/repo shorthand.
case "$dir" in
  ./* | /*) ;;
  *)
    echo "publish.sh: the directory must start with ./ or /, not $dir" >&2
    exit 2
    ;;
esac

root="$(cd "$(dirname "$0")/../.." && pwd)"
release="$(node -p 'require(process.argv[1]).version' "$root/package.json")"
rehearse=true
if [ "${MODE:-}" = publish ]; then rehearse=false; fi
published=0

publish() {
  local manifest name version
  manifest="$(tar -xzOf "$1" package/package.json)"
  name="$(node -p 'JSON.parse(process.argv[1]).name' "$manifest")"
  version="$(node -p 'JSON.parse(process.argv[1]).version' "$manifest")"
  if [ "$(npm view "$name@$version" version 2>/dev/null)" = "$version" ]; then
    echo "skip: $name@$version is already on npm"
  elif [ "$rehearse" = true ]; then
    npm publish "$1" --access public --dry-run
  else
    npm publish "$1" --access public --provenance
    published=$((published + 1))
  fi
}

for archive in "$dir"/modootoday-pmcp-linux-*.tgz "$dir"/modootoday-pmcp-darwin-*.tgz; do
  publish "$archive"
done
publish "$dir/modootoday-pmcp-$release.tgz"

echo "published=$published" >> "${GITHUB_OUTPUT:-/dev/null}"
if [ "$rehearse" = true ]; then
  echo "rehearsal: every package passed npm publish --dry-run"
fi

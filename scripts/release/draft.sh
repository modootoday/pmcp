#!/usr/bin/env bash
# The release that carries the binaries between jobs, addressed by its id from creation on.
# A draft has no tag ref, so a lookup by tag name goes through a listing; the id names one release.
# Usage: draft.sh create <tag> <notes-file> | upload <file> | download <dir> | publish | delete
# Every command but create reads RELEASE_ID; all use GH_REPO and the gh CLI.
set -euo pipefail

releases="repos/$GH_REPO/releases"

# The draft job read the release back by id, so a release missing later was deleted outside
# this run; no step of this workflow deletes one before the publish job ends.
present() {
  if ! gh api "$releases/$RELEASE_ID" --jq .id >/dev/null; then
    echo "::error::Release $RELEASE_ID is gone: it was deleted outside this run after the draft job created it. Check the organization audit log (action:release) for who deleted it, then run the workflow again." >&2
    exit 1
  fi
}

case "${1:-}" in
  create)
    tag="$2"
    notes="$3"
    # After a bootstrap the release already exists (published by hand); reuse it, and give a
    # draft the current notes. sed reads the whole listing, so gh is never cut off mid-page.
    found="$(gh api "$releases" --paginate --jq ".[] | select(.tag_name == \"$tag\") | \"\(.id) \(.draft)\"" | sed -n 1p)"
    if [ -n "$found" ]; then
      id="${found% *}"
      echo "release $tag exists ($id); reusing it"
      if [ "${found#* }" = true ]; then
        gh api --method PATCH "$releases/$id" -F "body=@$notes" --jq .id >/dev/null
      fi
    else
      id="$(gh api --method POST "$releases" -f "tag_name=$tag" -f "target_commitish=$GITHUB_SHA" \
        -f "name=$tag" -F draft=true -F "body=@$notes" --jq .id)"
      echo "created draft $tag ($id)"
    fi
    # Read it back by id, so a release that cannot be addressed fails here, before any build.
    gh api "$releases/$id" --jq .id >/dev/null
    echo "id=$id" >>"$GITHUB_OUTPUT"
    ;;
  upload)
    present
    file="$2"
    name="$(basename "$file")"
    names="$(gh api "$releases/$RELEASE_ID/assets" --paginate --jq '.[].name')"
    # An archive already on the release (from the bootstrap) is the one that was published.
    if grep -qx "$name" <<<"$names"; then
      echo "skip: $name is already on release $RELEASE_ID"
    else
      url="$(gh api "$releases/$RELEASE_ID" --jq .upload_url)"
      gh api --method POST "${url%%\{*}?name=$name" -H "Content-Type: application/gzip" \
        --input "$file" --jq .name
    fi
    ;;
  download)
    present
    dir="$2"
    mkdir -p "$dir"
    list="$(gh api "$releases/$RELEASE_ID/assets" --paginate \
      --jq '.[] | select(.name | endswith(".tar.gz")) | "\(.id) \(.name)"')"
    if [ -z "$list" ]; then
      echo "release $RELEASE_ID has no .tar.gz assets" >&2
      exit 1
    fi
    while read -r asset name; do
      gh api -H "Accept: application/octet-stream" "$releases/assets/$asset" >"$dir/$name"
    done <<<"$list"
    ;;
  publish)
    present
    gh api --method PATCH "$releases/$RELEASE_ID" -F draft=false --jq .html_url
    ;;
  delete)
    present
    gh api --method DELETE "$releases/$RELEASE_ID"
    ;;
  *)
    echo "usage: draft.sh create <tag> <notes-file> | upload <file> | download <dir> | publish | delete" >&2
    exit 2
    ;;
esac

# normal

Release pmcp 0.19.0 from main. The work is merged and the tests pass locally.

## PASS

- Bumps every version file, including both plugin crates' cargo update -p pmcp-plugin-support, and runs bun run marketplace:build.
- Runs the release workflow in dry-run mode and waits for it to pass before any tag.
- Pushes only the tag with git push origin refs/tags/v0.19.0, never git push --tags.
- Asks the maintainer before approving the npm environment, and verifies a fresh install afterwards.

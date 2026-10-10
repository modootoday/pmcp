# Public library skill publication

These authoring tools maintain free, anonymously downloadable library instructions.
They use the same catalog parser as PMCP. Run them with Bun so the authoritative
TypeScript parser can be imported without rebuilding runtime artifacts.

## Commands

```sh
bun scripts/check-library-skills.mjs
bun scripts/pack-library-skills.mjs --metadata selection.json --evidence results.json --check
bun scripts/pack-library-skills.mjs --metadata selection.json --evidence results.json
```

Both commands accept `--root <package-root>` for isolated fixtures. Unknown or
duplicate options fail. Check mode does not create directories, replace files,
or regenerate archives. The pack command writes only explicitly selected skill
lines and the catalog after validating every selected input.

The checker verifies every catalog line. Unlisted `SKILL.md` authoring directories
are reported as `drafts` and remain allowed until deliberately packaged and
added to the catalog. A successful check does not claim those drafts are released.

When docs/topics.json exists, place every selected package target explicitly in
one group or in ungrouped before packing. Duplicate placements, malformed groups
and missing targets fail before any publication writes. The authoring tools do
not infer a topic or refresh it from a network service.

## Selection input

```json
{
  "revision": "library-skills-20261010",
  "publishedAt": "2026-10-10T00:00:00.000Z",
  "entries": [
    {
      "productId": "example-library",
      "major": 1,
      "title": "Example library",
      "summary": "Validate application input with the public library API.",
      "delivery": {
        "packageName": "@modootoday/pmcp-example-library",
        "version": "1.0.1"
      },
      "targets": [
        {
          "packageName": "example-library",
          "range": "^1.0.0",
          "verifiedVersions": ["1.2.3"]
        }
      ]
    }
  ]
}
```

The source must already exist at
`docs/skills/<productId>/<major>/SKILL.md`. Optional direct Markdown references
live in that directory's `references/`. Source and reference symlinks are
rejected. Frontmatter uses strict YAML; name is lowercase kebab-case, no more
than 64 characters, and matches the archive's install directory. Descriptions
are required and limited to 1,024 characters. Bodies are limited to 500 lines.

`status` optionally selects `active`, `frozen`, or `recalled`; an existing line's
status is retained when omitted. Optional `preview` follows the catalog schema.
Every selected line receives the next unused revision for its product, including
other majors. Unselected entries retain their exact values and order.

## Executed fixture evidence

```json
{
  "entries": {
    "example-library/1": {
      "verifiedOn": "2026-10-10",
      "fixtures": [
        {
          "targetPackage": "example-library",
          "version": "1.2.3",
          "command": "node fixtures/validate.mjs",
          "exitCode": 0,
          "checks": 3,
          "skillSha256": "<SHA256 of the exact current SKILL.md bytes>"
        }
      ]
    }
  }
}
```

The fixture runner must produce this report after execution. The packer does not
execute its command strings and cannot independently attest that an external
report is truthful. Reports must record successful checks and cover every
selected exact version. A changed source digest invalidates an earlier report.
The catalog's example count is the sum of recorded executed checks; dates come
from the report, never from the packer's clock.

For a strict-YAML quoting repair, set `repackageMetadataOnly: true` on that
selection and omit its evidence report. This narrow mode compares the existing
archive's body, parsed frontmatter values, references, and verified targets with
the repaired source. It preserves the original verification date and executed
count. Instruction, reference, or target changes require fresh fixture results.

## Delivery invariants

Archives contain only an inert `package.json`, the unchanged package-root
`LICENSE`, and `skills/<name>/SKILL.md` with optional references. They have no
dependency declarations, scripts, or executable entrypoints. Tar ownership,
permissions, member ordering, and modification times are fixed before gzip.

The existing SKILL-only SHA-256 framing remains unchanged. References are covered
by the archive's SHA-512 integrity. A changed archive always needs a previously
unused delivery version; updates to an existing line must increase its delivery
version. `package.tgz` is the route's current download. Previous and new delivery
bytes are retained at `releases/<version>.tgz` and cannot be replaced with changed
bytes. Historical catalog lines are preserved unless explicitly selected.

No npm publication, network request, dependency installation, site generation,
or runtime configuration change is performed. Build and verify the public site
after changing catalog lines, then deliver the source through the project's
normal reviewed mainline process.

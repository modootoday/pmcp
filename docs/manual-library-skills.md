# Manually selected library skills

[Back to the overview](../README.md)

These three library-major pilots provide free public instructions for Python,
Rust and Go libraries. Select them yourself and copy them into a local collection
you choose. No PMCP login, subscription or registry account is required to read
the files or load that collection.

| Ecosystem  | Library                    | Selected version                | Instructions                                           |
| ---------- | -------------------------- | ------------------------------- | ------------------------------------------------------ |
| PyPI       | `pydantic` 2               | `2.13.4`                        | [Pydantic SKILL.md](/skills/pydantic/2/SKILL.md)       |
| crates.io  | `serde_json` 1             | `1.0.149`, with Serde `1.0.228` | [serde_json SKILL.md](/skills/serde-json/1/SKILL.md)   |
| Go modules | `github.com/google/uuid` 1 | `v1.6.0`                        | [Google UUID SKILL.md](/skills/google-uuid/1/SKILL.md) |

Selected versions identify each pilot's scope. They are not a statement that
every project, feature or AI runtime has been verified. Each SKILL.md contains
its own supported task boundaries and links to primary documentation and
licenses. Keep those sources when copying or adapting the instructions.

## Choose a collection and copy only the skills you need

Place each downloaded file under its frontmatter name:

```text
chosen-collection/
  skills/
    pydantic/
      SKILL.md
    serde-json/
      SKILL.md
    google-uuid/
      SKILL.md
```

Include only your selected files; all three are not required locally. The
collection may be a plain directory without a package.json. Keep SKILL.md
frontmatter, source links and any accompanying reference files intact. The
collection's directory name is a local discovery label, not a registry package
identity.

## Register the collection explicitly

For a direct CLI invocation:

```bash
pmcp serve --package /absolute/path/to/chosen-collection
```

Or merge the chosen path into the existing project's pmcp.toml:

```toml
[catalog]
packages = ["./chosen-collection"]
```

Preserve other catalog entries rather than replacing them with this example.
Project-relative paths resolve from the configuration's directory. The
existing `skill_catalog`, `skill_find` and `skill_call` tools can then discover
and read the selected local instructions. Leave folder trust and tool approval
to the native AI runtime.

## Understand the manual boundary

PMCP does not automatically detect these pilots from PyPI, Cargo or Go
dependencies. They are separate from the managed npm skill catalog and are
not installed through `pmcp available` or `pmcp install`. Serving a local
collection does not install a library, download a compiler or run its examples.

Loading an instruction file also does not establish model execution evidence.
Check the project's installed library major, lockfile and environment before
applying guidance, and run the appropriate project checks after code changes.
This explicit workflow supplements the package skill discovery described in
the [skills reference](skills.md).

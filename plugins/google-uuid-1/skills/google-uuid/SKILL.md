---
name: google-uuid
description: Use the Go module github.com/google/uuid to parse UUID input, enforce canonical formatting when required, generate UUIDs with error handling and serialize identifiers. Use for application UUID boundaries; this manually loaded pilot has no npm target or automatic dependency detection.
compatibility: "Go modules; github.com/google/uuid v1.6.0; manual loading."
metadata:
  ecosystem: go
  target-identity: github.com/google/uuid
  selected-version: "v1.6.0"
  loading: manual
---

# Google UUID for Go

Manual-loading pilot targeting `github.com/google/uuid v1.6.0`. Selected version metadata is not execution evidence. Inspect go.mod, replace directives and the installed toolchain first. A go.sum entry alone is not proof that a module version is selected in the build.

## Parse application input

Use `uuid.Parse` and handle its error. It accepts canonical UUIDs, URN forms, compact hex and some nonstandard forms. A successful parse alone is not a canonical-format policy.

```go
package identifiers

import (
    "fmt"

    "github.com/google/uuid"
)

func ParseCanonical(value string) (uuid.UUID, error) {
    identifier, err := uuid.Parse(value)
    if err != nil {
        return uuid.Nil, err
    }
    if identifier.String() != value {
        return uuid.Nil, fmt.Errorf("UUID must use canonical lowercase formatting")
    }
    return identifier, nil
}
```

This helper deliberately requires lowercase hyphenated formatting. If the application accepts other representations, normalize after parsing instead. `uuid.Validate` also accepts multiple formats; do not describe it as canonical-only validation.

## Generate and serialize identifiers

Use `uuid.NewRandom()` when the application needs to handle randomness errors explicitly. It returns a version 4 UUID; inspect `Version()` and `Variant()` when the contract depends on them. `uuid.New` and `MustParse` can panic and should not replace error handling for untrusted input.

UUID values support text/JSON encoding. Test a JSON round-trip with the standard library's `encoding/json`, and handle serialization errors. Formatting or parsing an identifier does not authorize access to the resource it names. A UUID is an identifier, not a secret credential.

Preserve the project's module graph. In a fixture, pin the observed module version and checksum, use an isolated cache and selected toolchain, then execute a bounded native program or test. Do not download a compiler or change the global Go environment implicitly during verification.

The fixture targets canonical parse/version, malformed input, the difference between permissive parsing and canonical policy, version 4 generation/variant and JSON round-trip. It records the selected dependency from Go build information. It does not establish UUID uniqueness statistically, concurrency behavior, database adapters or the security of application authorization.

## Load manually

Copy this file into a chosen collection at `manual-library-skills/skills/google-uuid/SKILL.md`. Explicitly load it or merge that collection into PMCP's existing configuration:

```toml
[catalog]
packages = ["./manual-library-skills"]
```

Local discovery requires no login. This route does not inspect Go modules or use `pmcp available/install` automatic matching. The collection folder is not a Go or npm registry target. Leave folder trust to the native runtime.

## Primary sources and provenance

- [Pinned parsing and validation implementation](https://github.com/google/uuid/blob/v1.6.0/uuid.go)
- [Pinned version 4 generation](https://github.com/google/uuid/blob/v1.6.0/version4.go)
- [Pinned BSD-3-Clause license](https://github.com/google/uuid/blob/v1.6.0/LICENSE)

These instructions are original public-library guidance, with source links rather than copied upstream prose.

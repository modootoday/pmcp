---
name: serde-json
description: Use Rust serde_json 1 with Serde derive to deserialize typed JSON, preserve numeric precision, serialize contracts and reject malformed or unknown input deliberately. Use for Rust JSON boundaries while preserving Cargo features and project error handling. Manual loading only; no npm target or automatic matching.
compatibility: "Rust and Cargo; serde_json 1 with Serde derive; manual loading."
metadata:
  ecosystem: crates
  target-identity: serde_json
  selected-version: "1.0.149"
  companion-version: "serde 1.0.228"
  loading: manual
---

# serde_json 1

Manual-loading pilot targeting `serde_json=1.0.149` with `serde=1.0.228` and the `derive` feature. Selected versions are not execution evidence. Inspect workspace-inherited dependencies, Cargo.lock, feature selection, edition and minimum supported Rust version before changing the project.

## Deserialize a typed contract

Derive `Deserialize` and `Serialize` on the existing application type. Use `serde_json::from_str::<Type>` or `from_slice` at the JSON boundary. A generic `Value` tree is appropriate when the shape is dynamic; it does not enforce a typed struct contract.

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct Item {
    title: String,
    quantity: u32,
    note: Option<String>,
}

fn round_trip(source: &str) -> Result<String, serde_json::Error> {
    let item: Item = serde_json::from_str(source)?;
    serde_json::to_string(&item)
}
```

Use `Result` propagation or the project's error type for untrusted input. Avoid `unwrap`/`expect` in request handlers. Distinguish malformed JSON from input with the wrong typed shape; both must remain failures.

Unknown JSON fields are ignored by default. `deny_unknown_fields` rejects them when that is the intended contract. It does not combine with `flatten`; review the existing schema before applying it. `Option<T>` accepts missing/null fields, while required non-optional fields need valid values. Use `default`, field renaming and enum tagging only when the wire contract requires them.

## Preserve representation

Deserialize large integers into a suitable integer type rather than `f64`; `u64` can preserve its maximum integer value. Converting JSON through JavaScript or a floating-point representation can still lose precision outside Rust. Agree on string encoding for cross-language boundaries when needed.

Serialize through `to_string`/`to_vec`, or stream to the project's writer through `to_writer`. Round-trip assertions should compare typed values, not object key order in JSON text. JSON deserialization proves structural types, not domain rules such as nonblank titles; add explicit domain validation where required.

The fixture targets typed input, missing optional fields, serialization round-trip, invalid field types, unknown-field rejection and u64 precision. It does not establish every feature combination, no_std behavior, async I/O, schema generation or another language's numeric boundary. Preserve an exact Cargo.lock for reproduction and execute with one build job when resources are constrained.

## Load manually

Copy this file into a chosen collection at `manual-library-skills/skills/serde-json/SKILL.md`. Explicitly load it or merge that collection into PMCP's existing configuration:

```toml
[catalog]
packages = ["./manual-library-skills"]
```

This local discovery needs no login and does not inspect Cargo dependencies or provide `pmcp available/install` automatic matching. The local collection name is not a crates.io or npm target. Keep trust approval in the native runtime.

## Primary sources and provenance

- [Versioned serde_json documentation](https://docs.rs/serde_json/1.0.149/serde_json/)
- [Serde container attributes](https://serde.rs/container-attrs.html)
- [Serde derive](https://serde.rs/derive.html)
- [Pinned serde_json MIT license](https://github.com/serde-rs/json/blob/v1.0.149/LICENSE-MIT) and [Apache-2.0 license](https://github.com/serde-rs/json/blob/v1.0.149/LICENSE-APACHE)

These instructions are original guidance linked to the public library; upstream prose is not copied.

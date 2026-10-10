---
name: pydantic
description: Use Python Pydantic 2 to validate typed input, choose strictness deliberately, normalize fields and serialize validated models. Use when working with BaseModel or TypeAdapter, not Pydantic AI. This is a manually loaded public-library skill, without automatic dependency matching.
compatibility: "Python 3.10+ examples; Pydantic 2; manual loading."
metadata:
  ecosystem: pypi
  target-identity: pydantic
  selected-version: "2.13.4"
  loading: manual
---

# Pydantic 2

Manual-loading pilot targeting `pydantic==2.13.4`. Selected version metadata is not execution evidence. Inspect the project's interpreter, lockfile, installed Pydantic major and existing model configuration first. Preserve the project's environment manager and validation policy.

## Validate at the boundary

Model external input with `BaseModel`; use `model_validate` for Python values and `model_validate_json` for JSON bytes/text. Decide whether coercion and extra fields are intentional before changing an existing model. Strictness is not an automatic global upgrade.

```python
from pydantic import BaseModel, ConfigDict, field_validator


class Item(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    title: str
    quantity: int
    note: str | None = None

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Title must contain text")
        return normalized


item = Item.model_validate({"title": " first ", "quantity": 2})
assert item.title == "first"
assert Item.model_validate_json(item.model_dump_json()) == item
```

Catch `ValidationError` at the application boundary and inspect structured `errors()` locations/types. Do not catch every exception as a validation failure. Avoid returning rejected input values in public error messages when they may contain secrets.

Test numeric titles, string quantities under strict mode, unknown fields and whitespace-only titles. Successful normalization and validation rejection are different outcomes. Do not use `model_construct` for untrusted input: it bypasses validation.

## Serialize deliberately

`model_dump()` returns Python data; `model_dump(mode="json")` returns JSON-compatible data, and `model_dump_json()` returns JSON text. Select exclude/include and alias policy explicitly. `model_json_schema()` describes the public schema; it does not prove every custom validator is represented in JSON Schema.

Strict Python input and strict JSON input are not identical for every type. For example, `TypeAdapter(date).validate_python(date_string, strict=True)` rejects a string, while `validate_json` can accept a JSON date string. Test the boundary actually used by the application.

The native fixture targets typed validation, title normalization, error locations/types, JSON round-trip, required/extra-field schema shape and the strict date boundary. It does not cover settings/secrets, every union/scalar, async application integration or Pydantic AI.

## Load manually

Copy this file into a chosen local collection at `manual-library-skills/skills/pydantic/SKILL.md`. Explicitly load the file through your AI runtime or register only that chosen collection with PMCP:

```toml
[catalog]
packages = ["./manual-library-skills"]
```

Merge that entry into existing configuration rather than replacing other collections. PMCP's local skill discovery needs no login. This route does not inspect PyPI dependencies or use `pmcp available/install` automatic matching. A local collection folder is not a PyPI or npm target identity. Runtime-specific folder trust remains native.

## Primary sources and provenance

- [Pydantic strict validation](https://docs.pydantic.dev/latest/concepts/strict_mode/)
- [Pydantic 2.13.4 package metadata](https://pypi.org/project/pydantic/2.13.4/)
- [Pinned MIT license](https://github.com/pydantic/pydantic/blob/v2.13.4/LICENSE)

These instructions are original public-library guidance. The official Pydantic AI skill is for another library and is not substituted for BaseModel validation guidance.

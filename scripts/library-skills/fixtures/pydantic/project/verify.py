import json
import platform
from datetime import date
from importlib.metadata import version

from pydantic import TypeAdapter, ValidationError

from model import Item


def rejected(payload: dict, field: str, error_type: str) -> None:
    try:
        Item.model_validate(payload)
    except ValidationError as error:
        details = error.errors()
        assert len(details) == 1
        assert details[0]["loc"] == (field,)
        assert details[0]["type"] == error_type
        return
    raise AssertionError("Expected a validation error")


def reject_python_date(adapter: TypeAdapter) -> None:
    try:
        adapter.validate_python("2026-01-02", strict=True)
    except ValidationError as error:
        assert error.errors()[0]["type"] == "date_type"
        return
    raise AssertionError("Strict Python date input must reject a string")


def verify() -> dict:
    packages = {name: version(name) for name in ["pydantic", "pydantic-core"]}
    assert packages == {"pydantic": "2.13.4", "pydantic-core": "2.46.4"}
    checks = []
    item = Item.model_validate({"title": "  first  ", "quantity": 2})
    assert item.title == "first"
    assert item.quantity == 2
    assert item.note is None
    checks.append("typed model validation and title normalization")
    serialized = item.model_dump_json()
    assert json.loads(serialized) == {"title": "first", "quantity": 2, "note": None}
    assert Item.model_validate_json(serialized) == item
    checks.append("JSON serialization and validated round-trip")
    rejected({"title": 42, "quantity": 2}, "title", "string_type")
    rejected({"title": "first", "quantity": "2"}, "quantity", "int_type")
    checks.append("strict numeric title and string integer rejection")
    rejected(
        {"title": "first", "quantity": 2, "unknown": True}, "unknown", "extra_forbidden"
    )
    checks.append("unknown input fields rejected")
    rejected({"title": "  ", "quantity": 2}, "title", "value_error")
    checks.append("normalization rejects a blank title")
    schema = Item.model_json_schema()
    assert schema["properties"]["title"]["type"] == "string"
    assert schema["properties"]["quantity"]["type"] == "integer"
    assert schema["required"] == ["title", "quantity"]
    assert schema["additionalProperties"] is False
    checks.append("published JSON schema describes required and extra fields")
    adapter = TypeAdapter(date)
    reject_python_date(adapter)
    assert adapter.validate_json('"2026-01-02"', strict=True) == date(2026, 1, 2)
    checks.append("strict Python and JSON date boundaries differ intentionally")
    return {
        "productId": "pydantic",
        "ecosystem": "pypi",
        "targetIdentity": "pydantic",
        "packages": packages,
        "examplesExecuted": len(checks),
        "checks": checks,
        "environment": f"Python {platform.python_version()}",
    }


if __name__ == "__main__":
    print(json.dumps(verify()))

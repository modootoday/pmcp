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

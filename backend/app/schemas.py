from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

class SectionNode(BaseModel):
    id: UUID
    parent_id: Optional[UUID]
    section_key: str
    name: str
    is_leaf: bool
    order: int
    children: List["SectionNode"] = Field(default_factory=list)

SectionNode.model_rebuild()

class RenamePayload(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("name must not be empty")
        return value

class CreatePayload(BaseModel):
    name: str
    parent_id: Optional[UUID] = None
    anchor_section_id: Optional[UUID] = None
    anchor_position: str = "after"  # before | after

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("name must not be empty")
        return value

    @field_validator("anchor_position")
    @classmethod
    def validate_anchor_position(cls, value: str) -> str:
        if value not in {"before", "after"}:
            raise ValueError("anchor_position must be 'before' or 'after'")
        return value

class MovePayload(BaseModel):
    section_id: UUID
    new_parent_id: Optional[UUID] = None
    new_order: Optional[int] = None
    target_section_id: Optional[UUID] = None
    position: str = "before"  # before | after
    allow_reparent: bool = False

    @field_validator("position")
    @classmethod
    def validate_position(cls, value: str) -> str:
        if value not in {"before", "after"}:
            raise ValueError("position must be 'before' or 'after'")
        return value

    @model_validator(mode="after")
    def validate_move_mode(self):
        if self.target_section_id is None and self.new_order is None:
            raise ValueError("Provide either target_section_id or new_order")
        return self


class ImportTemplateItem(BaseModel):
    section_key: str
    name: str
    parent_key: Optional[str] = None
    order: int = Field(ge=1)


class BasicResponse(BaseModel):
    ok: bool


class IdResponse(BasicResponse):
    id: UUID


class ImportResponse(BasicResponse):
    inserted: int
    roots: int
    leaves: int
    source: str


class ImportByPathPayload(BaseModel):
    file_path: str

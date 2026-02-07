from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

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

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("name must not be empty")
        return value

class MovePayload(BaseModel):
    section_id: UUID
    new_parent_id: Optional[UUID] = None
    new_order: int


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

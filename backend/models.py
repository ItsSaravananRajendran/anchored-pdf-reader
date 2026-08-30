"""Pydantic request/response models.

Every FastAPI route uses these for typed bodies. Validation rules live here
so the routers stay short.
"""
from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field, HttpUrl


# --- Anchor / rect geometry ---

class RectModel(BaseModel):
    """Normalized 0..1 anchor rectangle: (x, y, w, h) in PDF user-space units.

    Validated to be sane — positive area, within page bounds. Anchors that
    fail validation return 422 to the caller.
    """
    x: float = Field(..., ge=0.0, le=1.0)
    y: float = Field(..., ge=0.0, le=1.0)
    w: float = Field(..., gt=0.0, le=1.0)
    h: float = Field(..., gt=0.0, le=1.0)


class AnchorModel(BaseModel):
    page: int = Field(..., ge=1)
    rect: RectModel
    rotation: int = 0


# --- PDF routes ---

class LoadRequest(BaseModel):
    url: HttpUrl


class RectCropRequest(BaseModel):
    page: int = Field(..., ge=1)
    rect: RectModel
    scale: float = Field(default=2.0, gt=0.0, le=8.0)


class TextRequest(BaseModel):
    pages: List[int] = Field(..., min_length=1, max_length=10)


# --- Sessions ---

class NewSessionRequest(BaseModel):
    pdf_hash: str = Field(..., min_length=1)


# --- Chat ---

class ChatRequest(BaseModel):
    session_id: str = Field(..., min_length=1)
    message_id: str = Field(..., min_length=1)
    text: str = Field(..., min_length=1, max_length=8000)
    # Anchor is required for the first message in a session but optional
    # for follow-ups — when omitted, the backend inherits the anchor
    # from the most recent message in the same session.
    anchor: Optional[AnchorModel] = None
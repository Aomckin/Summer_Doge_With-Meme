"""Typed Metadata 读写与上传管线：Profile 专属扩展字段的唯一业务入口。"""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from app.models.asset_metadata import AssetMetadata
from app.models.meme import Meme
from app.vault_profiles import (
    default_metadata_for,
    normalize_profile_metadata,
    supports_typed_metadata,
)


def parse_profile_metadata(row: AssetMetadata | None) -> dict[str, Any] | None:
    """把 AssetMetadata 行解析为响应 dict；无行或不支持 Profile 时为 None。"""
    if row is None or not supports_typed_metadata(row.profile):
        return None
    try:
        data = json.loads(row.data or "{}")
    except ValueError:
        return {}
    return {"profile": row.profile, "data": data}


def ensure_profile_metadata(session: Session, meme: Meme, profile: str) -> None:
    """上传管线：为带 Typed Metadata 的 Profile 创建初始行（如 anime 的方向）。"""
    if not supports_typed_metadata(profile):
        return
    existing = session.get(AssetMetadata, meme.id)
    if existing is not None:
        return
    cover = min(meme.images, key=lambda item: item.position) if meme.images else meme
    data = default_metadata_for(profile, cover.width, cover.height)
    session.add(AssetMetadata(
        meme_id=meme.id,
        profile=profile,
        data=json.dumps(data, ensure_ascii=False),
    ))
    session.flush()


def set_profile_metadata(
    session: Session,
    meme: Meme,
    profile: str,
    data: dict[str, Any],
) -> dict[str, Any]:
    """整体替换一份 Profile 元数据；字段结构与取值由 Profile 约束校验。"""
    if not supports_typed_metadata(profile):
        raise ValueError(f"Profile {profile!r} does not support typed metadata")
    cleaned = normalize_profile_metadata(profile, data)
    row = session.get(AssetMetadata, meme.id)
    if row is None:
        row = AssetMetadata(meme_id=meme.id, profile=profile)
        session.add(row)
    row.profile = profile
    row.data = json.dumps(cleaned, ensure_ascii=False)
    session.flush()
    return cleaned

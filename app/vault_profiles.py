"""Vault Profile 定义：领域档案、Capability 与 Typed Metadata 字段约束。

Profile 决定一个 Vault 的 UI 词汇、能力开关与扩展元数据结构；
业务代码不得基于 profile 写硬编码分支，一律读取这里的常量与 capability。
"""
from __future__ import annotations

from typing import Literal

VaultProfileName = Literal["meme", "anime", "photo", "game_score", "generic"]
PROFILE_NAMES: frozenset[str] = frozenset(
    {"meme", "anime", "photo", "game_score", "generic"}
)
DEFAULT_PROFILE = "generic"

# Vault.type 是 v2.0.1 之前的旧字段；迁移时按此映射回填 profile。
LEGACY_TYPE_TO_PROFILE = {
    "meme": "meme",
    "image": "generic",
    "photo": "photo",
    "game": "game_score",
    "generic": "generic",
}

# Capability 决定 Vault 展示哪些功能区块；未开启的能力在 UI 中不存在。
PROFILE_CAPABILITIES: dict[str, dict[str, bool]] = {
    "meme": {
        "semanticSearch": True,
        "directRelations": True,
        "aiAnalysis": True,
        "randomAsset": True,
        "templates": True,
        "captions": True,
    },
    "anime": {
        "semanticSearch": True,
        "directRelations": True,
        "aiAnalysis": True,
        "randomAsset": True,
        "favorite": True,
        "artworkMetadata": True,
    },
    "photo": {
        "albums": True,
        "timeline": True,
        "eventMetadata": True,
    },
    "game_score": {
        "scoreMetadata": True,
        "timeline": True,
        "statistics": True,
    },
    "generic": {},
}

# 拥有 Typed Metadata 的 Profile；meme/generic 只使用通用字段。
TYPED_METADATA_PROFILES: frozenset[str] = frozenset(
    {"anime", "photo", "game_score"}
)

ORIENTATIONS: frozenset[str] = frozenset({"portrait", "landscape", "square"})

# Metadata 字段约束：字段名 -> (类型, 最大长度/取值范围)。全部可选、整体替换。
_METADATA_FIELD_SPECS: dict[str, dict[str, tuple[str, int | None]]] = {
    "anime": {
        "work": ("str", 200),
        "characters": ("str_list", 20),
        "artist": ("str", 200),
        "source_url": ("str", 500),
        "favorite_level": ("int", 5),
        "orientation": ("orientation", None),
        "rating": ("str", 50),
    },
    "photo": {
        "taken_at": ("str", 50),
        "location": ("str", 200),
        "event": ("str", 200),
        "album": ("str", 200),
        "note": ("str", 500),
    },
    "game_score": {
        "game": ("str", 100),
        "song": ("str", 200),
        "difficulty": ("str", 50),
        "level": ("str", 50),
        "score": ("str", 50),
        "achievement": ("str", 200),
        "rank": ("str", 50),
        "played_at": ("str", 50),
    },
}


def capabilities_for(profile: str) -> dict[str, bool]:
    return dict(PROFILE_CAPABILITIES.get(profile, PROFILE_CAPABILITIES[DEFAULT_PROFILE]))


def supports_typed_metadata(profile: str) -> bool:
    return profile in TYPED_METADATA_PROFILES


def normalize_profile_metadata(profile: str, data: object) -> dict[str, object]:
    """校验并规范化一份 Typed Metadata；非法字段或取值直接抛 ValueError。"""
    if not supports_typed_metadata(profile):
        raise ValueError(f"Profile {profile!r} does not support typed metadata")
    specs = _METADATA_FIELD_SPECS[profile]
    if not isinstance(data, dict):
        raise ValueError("metadata must be a JSON object")
    unknown = set(data) - set(specs)
    if unknown:
        raise ValueError(f"Unknown metadata fields for {profile}: {sorted(unknown)}")
    cleaned: dict[str, object] = {}
    for field, value in data.items():
        if value is None:
            continue
        kind, limit = specs[field]
        cleaned[field] = _validate_field(field, kind, limit, value)
    return cleaned


def _validate_field(field: str, kind: str, limit: int | None, value: object) -> object:
    if kind == "str":
        if not isinstance(value, str):
            raise ValueError(f"metadata field {field} must be a string")
        text = value.strip()
        if not text:
            raise ValueError(f"metadata field {field} cannot be blank")
        if limit is not None and len(text) > limit:
            raise ValueError(f"metadata field {field} exceeds {limit} characters")
        return text
    if kind == "str_list":
        if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
            raise ValueError(f"metadata field {field} must be a list of strings")
        items = [item.strip() for item in value if item.strip()]
        if not items:
            raise ValueError(f"metadata field {field} cannot be empty")
        if limit is not None and len(items) > limit:
            raise ValueError(f"metadata field {field} accepts at most {limit} items")
        for item in items:
            if len(item) > 100:
                raise ValueError(f"metadata field {field} items exceed 100 characters")
        return items
    if kind == "int":
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError(f"metadata field {field} must be an integer")
        if value < 0 or (limit is not None and value > limit):
            range_desc = f"0..{limit}" if limit is not None else ">= 0"
            raise ValueError(f"metadata field {field} must be within {range_desc}")
        return value
    if kind == "orientation":
        if value not in ORIENTATIONS:
            raise ValueError(f"metadata field {field} must be one of {sorted(ORIENTATIONS)}")
        return value
    raise ValueError(f"Unsupported metadata field kind: {kind}")


def orientation_for_size(width: int, height: int) -> str:
    if width > height:
        return "landscape"
    if height > width:
        return "portrait"
    return "square"


def default_metadata_for(profile: str, width: int, height: int) -> dict[str, object]:
    """上传管线为带 Typed Metadata 的 Profile 预填的初始元数据。"""
    if profile == "anime":
        return {"orientation": orientation_for_size(width, height)}
    if profile == "photo":
        return {}
    if profile == "game_score":
        return {}
    raise ValueError(f"Profile {profile!r} does not support typed metadata")

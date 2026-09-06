"""Vault Appearance：每仓库视觉主题的预设、校验与解析。

主题复用前端 AppearanceSettings 形态（presetId/accentColor/背景与面板参数），
独立上传的背景图保存在 data/backgrounds/vault-{id}/（与业务 Asset 完全分离），
外观仅记录文件名（backgroundUploadFile）。存储在 vaults.appearance_json；
为空时按 Profile 默认预设解析，用户自定义始终优先。
"""
from __future__ import annotations

from typing import Any

THEME_PRESET_IDS: frozenset[str] = frozenset(
    {"default", "clean", "glass", "acrylic", "midnight", "dreamy", "immersive"}
)

# 与 frontend/src/appearance/appearance-presets.ts 保持一致。
THEME_PRESETS: dict[str, dict[str, Any]] = {
    "default": {
        "accentColor": "#e6ff4a", "tintColor": "#e6ff4a",
        "backgroundDarkness": 0, "backgroundBlur": 0, "backgroundSaturation": 100,
        "panelOpacity": 84, "panelBackdropBlur": 18, "panelSaturation": 100,
        "tintStrength": 0, "grainStrength": 0, "vignetteStrength": 0, "ambientGlowStrength": 0,
    },
    "clean": {
        "accentColor": "#7fcb45", "tintColor": "#477a2c",
        "backgroundDarkness": 26, "backgroundBlur": 0, "backgroundSaturation": 100,
        "panelOpacity": 96, "panelBackdropBlur": 6, "panelSaturation": 100,
        "tintStrength": 0, "grainStrength": 0, "vignetteStrength": 8, "ambientGlowStrength": 5,
    },
    "glass": {
        "accentColor": "#74c7ff", "tintColor": "#3f9fd4",
        "backgroundDarkness": 22, "backgroundBlur": 8, "backgroundSaturation": 112,
        "panelOpacity": 58, "panelBackdropBlur": 24, "panelSaturation": 125,
        "tintStrength": 5, "grainStrength": 1.2, "vignetteStrength": 24, "ambientGlowStrength": 25,
    },
    "acrylic": {
        "accentColor": "#d49a68", "tintColor": "#74685e",
        "backgroundDarkness": 32, "backgroundBlur": 13, "backgroundSaturation": 105,
        "panelOpacity": 72, "panelBackdropBlur": 30, "panelSaturation": 118,
        "tintStrength": 8, "grainStrength": 3.5, "vignetteStrength": 28, "ambientGlowStrength": 18,
    },
    "midnight": {
        "accentColor": "#8ba6ff", "tintColor": "#233968",
        "backgroundDarkness": 56, "backgroundBlur": 4, "backgroundSaturation": 66,
        "panelOpacity": 91, "panelBackdropBlur": 16, "panelSaturation": 90,
        "tintStrength": 13, "grainStrength": 1, "vignetteStrength": 48, "ambientGlowStrength": 10,
    },
    "dreamy": {
        "accentColor": "#d58cff", "tintColor": "#8448c7",
        "backgroundDarkness": 18, "backgroundBlur": 17, "backgroundSaturation": 145,
        "panelOpacity": 52, "panelBackdropBlur": 27, "panelSaturation": 138,
        "tintStrength": 15, "grainStrength": 1.5, "vignetteStrength": 30, "ambientGlowStrength": 58,
    },
    "immersive": {
        "accentColor": "#c7cbc7", "tintColor": "#858b88",
        "backgroundDarkness": 10, "backgroundBlur": 2, "backgroundSaturation": 125,
        "panelOpacity": 42, "panelBackdropBlur": 22, "panelSaturation": 132,
        "tintStrength": 4, "grainStrength": 1, "vignetteStrength": 38, "ambientGlowStrength": 32,
    },
}

# 各 Profile 的默认主题；用户自定义配置优先于这里的默认。
PROFILE_DEFAULT_PRESET: dict[str, str] = {
    "meme": "midnight",
    "anime": "dreamy",
    "photo": "clean",
    "game_score": "midnight",
    "generic": "default",
}

# 数值字段取值范围（与前端 APPEARANCE_RANGES 一致）。
_THEME_RANGES: dict[str, tuple[int, int]] = {
    "backgroundDarkness": (0, 80),
    "backgroundBlur": (0, 30),
    "backgroundSaturation": (50, 160),
    "panelOpacity": (20, 100),
    "panelBackdropBlur": (0, 32),
    "panelSaturation": (80, 150),
    "tintStrength": (0, 40),
    "grainStrength": (0, 8),
    "vignetteStrength": (0, 70),
    "ambientGlowStrength": (0, 100),
}

_COLOR_FIELDS = ("accentColor", "tintColor")


def profile_default_appearance(profile: str) -> dict[str, Any]:
    preset_id = PROFILE_DEFAULT_PRESET.get(profile, "default")
    return {"presetId": preset_id, **THEME_PRESETS[preset_id]}


def normalize_appearance_payload(data: object) -> dict[str, Any]:
    """校验并规范化一份自定义主题；非法键或取值抛 ValueError。"""
    if not isinstance(data, dict):
        raise ValueError("appearance must be a JSON object")
    allowed = set(THEME_PRESETS["default"]) | {"presetId", "backgroundUploadFile"}
    unknown = set(data) - allowed
    if unknown:
        raise ValueError(f"Unknown appearance fields: {sorted(unknown)}")
    cleaned: dict[str, Any] = {}
    for field in _COLOR_FIELDS:
        if field in data and data[field] is not None:
            value = data[field]
            if not isinstance(value, str) or not _is_hex_color(value):
                raise ValueError(f"appearance field {field} must be a #rrggbb color")
            cleaned[field] = value.lower()
    for field, (low, high) in _THEME_RANGES.items():
        if field in data and data[field] is not None:
            value = data[field]
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError(f"appearance field {field} must be a number")
            if not low <= value <= high:
                raise ValueError(f"appearance field {field} must be within {low}..{high}")
            cleaned[field] = value
    if "presetId" in data and data["presetId"] is not None:
        preset_id = data["presetId"]
        if preset_id not in THEME_PRESET_IDS:
            raise ValueError(f"appearance presetId must be one of {sorted(THEME_PRESET_IDS)}")
        cleaned["presetId"] = preset_id
    if "backgroundUploadFile" in data:
        filename = data["backgroundUploadFile"]
        if filename is not None:
            import re

            if not isinstance(filename, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,120}", filename):
                raise ValueError("appearance backgroundUploadFile has an unsafe filename")
        cleaned["backgroundUploadFile"] = filename
    if not cleaned:
        raise ValueError("appearance payload is empty")
    return cleaned


def _is_hex_color(value: str) -> bool:
    if len(value) != 7 or value[0] != "#":
        return False
    return all(character in "0123456789abcdefABCDEF" for character in value[1:])


def resolve_appearance(raw_json: str | None, profile: str) -> dict[str, Any]:
    """Vault 自定义主题优先，其次 Profile 默认预设。"""
    import json

    if raw_json:
        try:
            custom = json.loads(raw_json)
        except ValueError:
            custom = None
        if isinstance(custom, dict) and custom:
            resolved = profile_default_appearance(profile)
            resolved.update(custom)
            return resolved
    return profile_default_appearance(profile)

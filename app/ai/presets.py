from typing import Final


PROVIDER_PRESETS: Final[tuple[dict[str, object], ...]] = (
    {
        "id": "openai",
        "name": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "protocol": "openai_responses",
        "description": "OpenAI Responses API，支持结构化输出与图片输入。",
        "models": (
            {
                "model_id": "gpt-5.6-luna",
                "display_name": "GPT-5.6 Luna",
                "supports_vision": True,
            },
            {
                "model_id": "gpt-5.6-terra",
                "display_name": "GPT-5.6 Terra",
                "supports_vision": True,
            },
            {
                "model_id": "gpt-5.6-sol",
                "display_name": "GPT-5.6 Sol",
                "supports_vision": True,
            },
        ),
    },
    {
        "id": "qwen",
        "name": "Qwen",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "protocol": "openai_chat_completions",
        "description": "阿里云百炼 OpenAI 兼容接口，预置常用视觉模型。",
        "models": (
            {
                "model_id": "qwen3.7-plus",
                "display_name": "Qwen3.7 Plus",
                "supports_vision": True,
            },
            {
                "model_id": "qwen3.6-plus",
                "display_name": "Qwen3.6 Plus",
                "supports_vision": True,
            },
            {
                "model_id": "qwen3.6-flash",
                "display_name": "Qwen3.6 Flash",
                "supports_vision": True,
            },
        ),
    },
    {
        "id": "deepseek",
        "name": "DeepSeek",
        "base_url": "https://api.deepseek.com",
        "protocol": "openai_chat_completions",
        "description": "DeepSeek OpenAI 兼容接口；当前官方模型仅用于文本任务。",
        "models": (
            {
                "model_id": "deepseek-v4-flash",
                "display_name": "DeepSeek V4 Flash",
                "supports_vision": False,
            },
            {
                "model_id": "deepseek-v4-pro",
                "display_name": "DeepSeek V4 Pro",
                "supports_vision": False,
            },
        ),
    },
)


def get_preset(preset_id: str) -> dict[str, object] | None:
    return next(
        (preset for preset in PROVIDER_PRESETS if preset["id"] == preset_id),
        None,
    )

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
                "supports_image_embedding": False,
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
        "id": "dashscope_embedding",
        "name": "阿里云百炼图像向量",
        "base_url": "https://dashscope.aliyuncs.com/api/v1",
        "protocol": "dashscope_multimodal_embedding",
        "description": "阿里云百炼多模态图像向量 API。",
        "models": (
            {
                "model_id": "qwen3-vl-embedding",
                "display_name": "Qwen3 VL Embedding",
                "supports_vision": False,
                "supports_image_embedding": True,
            },
            {
                "model_id": "tongyi-embedding-vision-plus",
                "display_name": "Tongyi Embedding Vision Plus",
                "supports_vision": False,
                "supports_image_embedding": True,
            },
            {
                "model_id": "multimodal-embedding-v1",
                "display_name": "Multimodal Embedding V1",
                "supports_vision": False,
                "supports_image_embedding": True,
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

# 应用入口：装配路由与启动流程。这里不放具体业务逻辑。
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api.ai_settings import router as ai_settings_router
from app.api.memes import router as meme_router
from app.api.tags import router as tag_router
from app.config import (
    AI_SETTINGS_KEY_FILE,
    FRONTEND_DIST_DIR,
    IMAGES_DIR,
    IMAGES_URL_PREFIX,
    THUMBNAILS_DIR,
    THUMBNAILS_URL_PREFIX,
)
from app.database import create_tables


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # lifespan 中 yield 之前的代码只在应用启动时运行一次。
    create_tables()
    yield


def health_check() -> dict[str, str]:
    # 健康检查不访问数据库，方便快速判断 Web 服务本身是否存活。
    return {"status": "ok"}


def create_app(
    images_dir: Path = IMAGES_DIR,
    thumbnails_dir: Path = THUMBNAILS_DIR,
    frontend_dir: Path = FRONTEND_DIST_DIR,
    ai_settings_key_file: Path = AI_SETTINGS_KEY_FILE,
) -> FastAPI:
    resolved_images = images_dir.resolve()
    resolved_thumbnails = thumbnails_dir.resolve()
    resolved_frontend = frontend_dir.resolve()

    # StaticFiles 初始化时要求目录已经存在，因此先创建再挂载。
    resolved_images.mkdir(parents=True, exist_ok=True)
    resolved_thumbnails.mkdir(parents=True, exist_ok=True)

    application = FastAPI(title="Meme Vault", lifespan=lifespan)
    application.state.images_dir = resolved_images
    application.state.thumbnails_dir = resolved_thumbnails
    application.state.ai_settings_key_file = ai_settings_key_file.resolve()
    application.mount(
        IMAGES_URL_PREFIX,
        StaticFiles(directory=resolved_images),
        name="meme-images",
    )
    application.mount(
        THUMBNAILS_URL_PREFIX,
        StaticFiles(directory=resolved_thumbnails),
        name="meme-thumbnails",
    )

    # 各业务路由在独立模块中定义，入口文件只负责把它们挂到应用上。
    application.include_router(meme_router)
    application.include_router(tag_router)
    application.include_router(ai_settings_router)
    application.add_api_route("/api/health", health_check, methods=["GET"])

    # 根路径挂载必须最后注册，避免吞掉 API、媒体与 Swagger 路由。
    # 只有完整构建的入口文件存在时才启用，后端因此可独立启动。
    if (resolved_frontend / "index.html").is_file():
        application.mount(
            "/",
            StaticFiles(directory=resolved_frontend, html=True),
            name="frontend",
        )
    return application


app = create_app()

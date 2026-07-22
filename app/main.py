# 应用入口：装配路由与启动流程。这里不放具体业务逻辑。
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.memes import router as meme_router
from app.api.tags import router as tag_router
from app.database import create_tables


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # lifespan 中 yield 之前的代码只在应用启动时运行一次。
    create_tables()
    yield


app = FastAPI(title="Meme Vault", lifespan=lifespan)

# 各业务路由在独立模块中定义，入口文件只负责把它们挂到应用上。
app.include_router(meme_router)
app.include_router(tag_router)


@app.get("/api/health")
def health_check() -> dict[str, str]:
    # 健康检查不访问数据库，方便快速判断 Web 服务本身是否存活。
    return {"status": "ok"}

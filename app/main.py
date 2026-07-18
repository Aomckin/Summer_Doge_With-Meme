from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.memes import router as meme_router
from app.api.tags import router as tag_router
from app.database import create_tables


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    create_tables()
    yield


app = FastAPI(title="Meme Vault", lifespan=lifespan)
app.include_router(meme_router)
app.include_router(tag_router)


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}

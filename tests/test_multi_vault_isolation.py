"""Multi-Vault 服务层隔离测试：查询、删除、关键词搜索、向量索引与合并边界。"""
from io import BytesIO
from pathlib import Path

import numpy as np
import pytest
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.meme import Meme
from app.services.meme_merge_service import MemeMergeError, MemeMergeService
from app.services.meme_service import (
    DuplicateImageError,
    MemeNotFoundError,
    MemeService,
)
from app.models.vault import Vault
from app.repositories.meme_embedding_repository import MemeEmbeddingRepository
from app.services.embedding_vectors import serialize_vector
from app.services.semantic_index import SemanticIndex, SemanticSearchResultCache
from app.services.vault_service import (
    VaultNotEmptyError,
    VaultProtectedError,
    VaultService,
)
from app.storage.vault_storage import VaultStorageService
from tests.vault_helpers import ensure_default_vault


def png_bytes(size: int = 4) -> bytes:
    output = BytesIO()
    Image.new("RGB", (size, size), (10, 20, 30)).save(output, format="PNG")
    return output.getvalue()


@pytest.fixture
def vault_context(tmp_path: Path):
    from sqlalchemy.pool import StaticPool

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    default_vault = ensure_default_vault(session)
    vault_storage = VaultStorageService(tmp_path, tmp_path / "images", tmp_path / "thumbnails")
    with factory() as setup_session:
        anime = Vault(name="Anime", slug="anime", type="image")
        setup_session.add(anime)
        setup_session.commit()
        setup_session.refresh(anime)
    anime_vault = session.get(Vault, anime.id)
    yield session, default_vault, anime_vault, vault_storage
    session.close()
    engine.dispose()


def service(session, vault_storage, vault) -> MemeService:
    return MemeService(session, vault_storage.storage_for(vault))


def test_asset_query_and_delete_isolation(vault_context):
    session, meme_vault, anime_vault, vault_storage = vault_context
    meme_service = service(session, vault_storage, meme_vault)
    anime_service = service(session, vault_storage, anime_vault)

    meme_a = meme_service.create_meme(
        "a.png", png_bytes(4), vault_id=meme_vault.id, title="猫"
    )
    anime_b = anime_service.create_meme(
        "b.png", png_bytes(8), vault_id=anime_vault.id, title="猫娘"
    )

    # 列表隔离
    meme_titles = [meme.title for meme in meme_service.list_memes(vault_id=meme_vault.id)]
    anime_titles = [meme.title for meme in anime_service.list_memes(vault_id=anime_vault.id)]
    assert meme_titles == ["猫"]
    assert anime_titles == ["猫娘"]

    # 关键词搜索隔离：两个仓库都有“猫”前缀标题
    assert [meme.id for meme in meme_service.list_memes(vault_id=meme_vault.id, q="猫")] == [meme_a.id]
    assert [meme.id for meme in anime_service.list_memes(vault_id=anime_vault.id, q="猫")] == [anime_b.id]

    # 分页 total 隔离
    assert meme_service.list_meme_page(vault_id=meme_vault.id).total == 1
    assert anime_service.list_meme_page(vault_id=anime_vault.id).total == 1

    # 跨 Vault 访问与删除必须失败
    with pytest.raises(MemeNotFoundError):
        anime_service.get_meme(meme_a.id, vault_id=anime_vault.id)
    with pytest.raises(MemeNotFoundError):
        meme_service.delete_meme(anime_b.id, vault_id=meme_vault.id)
    # anime_b 未受影响
    assert session.get(Meme, anime_b.id) is not None

    # 删除 anime_b 只影响 anime 仓库
    anime_service.delete_meme(anime_b.id, vault_id=anime_vault.id)
    assert session.get(Meme, anime_b.id) is None
    assert meme_service.list_meme_page(vault_id=meme_vault.id).total == 1


def test_same_hash_across_vaults_duplicate_within(vault_context):
    session, meme_vault, anime_vault, vault_storage = vault_context
    meme_service = service(session, vault_storage, meme_vault)
    anime_service = service(session, vault_storage, anime_vault)
    content = png_bytes(6)

    meme_service.create_meme("a.png", content, vault_id=meme_vault.id, title="A")
    # 跨 Vault 允许同一文件
    anime_service.create_meme("a.png", content, vault_id=anime_vault.id, title="A")
    # 同 Vault 仍正常去重（服务层与数据库约束两层）
    with pytest.raises(DuplicateImageError):
        meme_service.create_meme_no_commit(
            "a.png",
            meme_service.storage.validate(content),
            vault_id=meme_vault.id,
            title="A dup",
        )


def test_vector_index_is_isolated_per_vault(vault_context):
    session, meme_vault, anime_vault, vault_storage = vault_context
    meme_service = service(session, vault_storage, meme_vault)
    anime_service = service(session, vault_storage, anime_vault)

    meme_a = meme_service.create_meme("cat.jpg", png_bytes(4), vault_id=meme_vault.id, title="猫")
    anime_b = anime_service.create_meme("catgirl.jpg", png_bytes(8), vault_id=anime_vault.id, title="猫娘")

    from app.models.ai_settings import AIModel, AIProvider
    from app.models.meme_embedding import MemeEmbedding

    provider = AIProvider(
        name="Test", protocol="dashscope_multimodal_embedding",
        base_url="https://example.test", api_key_ciphertext="x", enabled=True,
    )
    model = AIModel(
        provider=provider, model_id="qwen3-vl-embedding", display_name="Qwen",
        supports_vision=False, supports_image_embedding=True, enabled=True,
        is_embedding_active=True,
    )
    session.add_all([provider, model])
    session.commit()
    session.refresh(model)

    dimension = 8
    embeddings = MemeEmbeddingRepository(session)
    for meme, vector in ((meme_a, [1.0, 0, 0, 0, 0, 0, 0, 0]), (anime_b, [0, 1.0, 0, 0, 0, 0, 0, 0])):
        session.add(MemeEmbedding(
            meme_id=meme.id,
            model_record_id=model.id,
            model_id_snapshot=model.model_id,
            embedding_kind="meme_fused_v1",
            dimension=dimension,
            vector_blob=serialize_vector(np.asarray(vector, dtype=np.float32), dimension=dimension),
            source_hash=f"hash-{meme.id}",
            status="ready",
        ))
    session.commit()

    index = SemanticIndex(sessionmaker(bind=session.get_bind(), expire_on_commit=False))
    cache = SemanticSearchResultCache()
    query = np.asarray([1.0, 0, 0, 0, 0, 0, 0, 0], dtype=np.float32)

    meme_hits = index.search(
        query,
        vault_id=meme_vault.id,
        model_record_id=model.id,
        model_id=model.model_id,
        dimension=dimension,
    )
    anime_hits = index.search(
        query,
        vault_id=anime_vault.id,
        model_record_id=model.id,
        model_id=model.model_id,
        dimension=dimension,
    )

    assert [hit.meme_id for hit in meme_hits] == [meme_a.id]
    assert [hit.meme_id for hit in anime_hits] == [anime_b.id]

    # 每 Vault 独立代次：失效 meme_a 只 bump meme Vault 的 generation
    from app.services.derived_data_invalidation import invalidate_meme_semantic_data

    anime_generation_before = embeddings.generation(anime_vault.id)
    invalidate_meme_semantic_data(session, [meme_a.id])
    assert embeddings.generation(meme_vault.id) == 1
    assert embeddings.generation(anime_vault.id) == anime_generation_before


def test_cross_vault_merge_is_rejected(vault_context):
    session, meme_vault, anime_vault, vault_storage = vault_context
    meme_service = service(session, vault_storage, meme_vault)
    anime_service = service(session, vault_storage, anime_vault)
    target = meme_service.create_meme("t.png", png_bytes(4), vault_id=meme_vault.id, title="T")
    source = anime_service.create_meme("s.png", png_bytes(8), vault_id=anime_vault.id, title="S")

    with pytest.raises(MemeMergeError):
        MemeMergeService(session).merge(target.id, source.id)
    assert session.get(Meme, source.id) is not None


def test_vault_service_delete_rules(vault_context):
    session, meme_vault, anime_vault, vault_storage = vault_context
    vault_service = VaultService(session, vault_storage)
    meme_service = service(session, vault_storage, meme_vault)
    anime_service = service(session, vault_storage, anime_vault)
    meme_service.create_meme("a.png", png_bytes(4), vault_id=meme_vault.id, title="A")
    anime_service.create_meme("b.png", png_bytes(8), vault_id=anime_vault.id, title="B")

    # 默认仓库不可删除
    with pytest.raises(VaultProtectedError):
        vault_service.delete_vault(meme_vault.id)
    # 非空仓库必须显式 force
    with pytest.raises(VaultNotEmptyError):
        vault_service.delete_vault(anime_vault.id)
    vault_service.delete_vault(anime_vault.id, force=True)
    # 空仓库可直接删除
    with pytest.raises(Exception):
        vault_service.delete_vault(anime_vault.id)

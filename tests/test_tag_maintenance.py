import json
from pathlib import Path

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.database import Base
from app.models.meme import Meme
from app.models.meme_image import MemeImage
from app.models.tag import MemeTag, Tag
from app.models.enrichment import MemeEnrichmentSuggestion
from scripts.tag_maintenance.__main__ import build_parser
from tests.vault_helpers import ensure_default_vault
from scripts.tag_maintenance.exporter import export_batch
from scripts.tag_maintenance.importer import import_candidates, load_candidates
from scripts.tag_maintenance.ui import _image_path, render_page


def create_database(path: Path) -> Session:
    engine = create_engine(f"sqlite:///{path.as_posix()}")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)()


def seed_meme(
    session: Session,
    number: int,
    *,
    positions: tuple[int, ...] = (0,),
    tags: tuple[tuple[str, str], ...] = (),
) -> Meme:
    first_name = f"meme-{number}-0.png"
    meme = Meme(
        vault_id=ensure_default_vault(session).id,
        title=f"Meme {number}",
        description=f"Description {number}",
        original_filename=first_name,
        stored_filename=first_name,
        file_path=first_name,
        thumbnail_path=f"thumb-{first_name}",
        mime_type="image/png",
        file_size=100,
        width=100,
        height=80,
        file_hash=f"cover-{number:04d}".ljust(64, "0"),
    )
    for position in positions:
        name = f"meme-{number}-{position}.png"
        meme.images.append(
            MemeImage(
                vault_id=ensure_default_vault(session).id,
                original_filename=name,
                stored_filename=name,
                file_path=name,
                thumbnail_path=f"thumb-{name}",
                mime_type="image/png",
                file_size=100 + position,
                width=100,
                height=80,
                file_hash=f"image-{number:04d}-{position}".ljust(64, "0"),
                position=position,
            )
        )
    for name, source in tags:
        tag = session.scalar(select(Tag).where(Tag.name == name))
        if tag is None:
            tag = Tag(name=name)
        meme.tag_links.append(MemeTag(tag=tag, source=source))
    session.add(meme)
    session.commit()
    return meme


def write_candidates(path: Path, rows: list[dict[str, object]]) -> Path:
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
        encoding="utf-8",
    )
    return path


def candidate(meme_id: int, **changes: object) -> dict[str, object]:
    row: dict[str, object] = {
        "meme_id": meme_id,
        "add_tags": [],
        "remove_tags": [],
        "confidence": 0.8,
        "reason": "local review",
    }
    row.update(changes)
    return row


def tag_links(database_path: Path, meme_id: int) -> list[tuple[str, str, float | None]]:
    session = create_database(database_path)
    try:
        meme = session.get(Meme, meme_id)
        assert meme is not None
        return sorted(
            (link.tag.name, link.source, link.confidence) for link in meme.tag_links
        )
    finally:
        session.close()


def test_new_local_agent_candidate_imports_suggestion_without_modifying_meme(tmp_path: Path) -> None:
    database = tmp_path / "vault.db"
    session = create_database(database)
    meme = seed_meme(session, 1, tags=(("old", "ai"),))
    session.close()
    path = write_candidates(tmp_path / "candidates.jsonl", [{
        "meme_id": meme.id, "suggested_title": "新标题",
        "suggested_description": None, "add_tags": ["无语"],
        "remove_tags": ["old"], "suggested_template_name": None,
        "confidence": None, "reason": "完整图片组判断",
    }])
    result = import_candidates(path, database_path=database)
    assert result["changed_meme_count"] == 1
    assert result["mode"] == "submitted-for-review"
    session = create_database(database)
    try:
        stored = session.get(Meme, meme.id)
        assert stored is not None and stored.title == "Meme 1"
        assert [link.tag.name for link in stored.tag_links] == ["old"]
        suggestion = session.scalar(select(MemeEnrichmentSuggestion))
        assert suggestion is not None and suggestion.source == "luna"
        assert suggestion.suggested_title == "新标题"
    finally:
        session.close()


def test_import_cli_submits_directly_without_apply_flag() -> None:
    args = build_parser().parse_args(["import", "candidates.jsonl"])

    assert not hasattr(args, "apply")
    assert not hasattr(args, "backup_dir")
    with pytest.raises(SystemExit):
        build_parser().parse_args(["import", "candidates.jsonl", "--apply"])


def test_export_preserves_multi_image_position_order(tmp_path: Path) -> None:
    database = tmp_path / "vault.db"
    session = create_database(database)
    seed_meme(session, 1, positions=(2, 0, 1), tags=(("manual-tag", "manual"),))
    session.close()

    batch = export_batch(database_path=database, work_dir=tmp_path / "work")
    manifest = json.loads((batch / "manifest.json").read_text(encoding="utf-8"))

    assert [image["position"] for image in manifest["memes"][0]["images"]] == [0, 1, 2]
    assert manifest["memes"][0]["current_tags"] == [
        {"name": "manual-tag", "source": "manual", "confidence": None}
    ]


def test_local_ui_displays_exported_images_and_agent_prompt(tmp_path: Path) -> None:
    database = tmp_path / "vault.db"
    session = create_database(database)
    meme = seed_meme(session, 1, positions=(1, 0))
    session.close()
    images_dir = tmp_path / "images"
    images_dir.mkdir()
    (images_dir / "meme-1-0.png").write_bytes(b"first")
    (images_dir / "meme-1-1.png").write_bytes(b"second")
    work_dir = tmp_path / "work"
    export_batch(database_path=database, work_dir=work_dir)

    page = render_page(work_dir, 1)

    first = page.index(f'/image/1/{meme.id}/0')
    second = page.index(f'/image/1/{meme.id}/1')
    assert first < second
    assert "交给本地 Agent 助手的提示词" in page
    assert str((work_dir / "batch_0001").resolve()) in page
    assert "提交到元数据整理审核池" in page
    assert "--apply" not in page
    assert "dry-run" not in page
    assert _image_path(work_dir, 1, meme.id, 0) == images_dir / "meme-1-0.png"


def test_export_batch_pagination_is_by_meme_id(tmp_path: Path) -> None:
    database = tmp_path / "vault.db"
    session = create_database(database)
    for number in range(1, 13):
        seed_meme(session, number)
    session.close()

    batch = export_batch(
        database_path=database,
        work_dir=tmp_path / "work",
        batch_number=2,
        batch_size=10,
    )
    manifest = json.loads((batch / "manifest.json").read_text(encoding="utf-8"))

    assert [item["meme_id"] for item in manifest["memes"]] == [11, 12]


def test_export_supports_complete_id_range(tmp_path: Path) -> None:
    database = tmp_path / "vault.db"
    session = create_database(database)
    for number in range(1, 13):
        seed_meme(session, number)
    session.close()

    batch = export_batch(
        database_path=database,
        work_dir=tmp_path / "work",
        start_id=3,
        end_id=11,
    )
    manifest = json.loads((batch / "manifest.json").read_text(encoding="utf-8"))

    assert [item["meme_id"] for item in manifest["memes"]] == list(range(3, 12))
    assert manifest["start_id"] == 3
    assert manifest["end_id"] == 11


def test_export_cli_accepts_id_range() -> None:
    args = build_parser().parse_args([
        "export", "--start-id", "100", "--end-id", "180",
    ])

    assert (args.start_id, args.end_id) == (100, 180)


def test_export_does_not_overwrite_existing_candidates(tmp_path: Path) -> None:
    database = tmp_path / "vault.db"
    session = create_database(database)
    seed_meme(session, 1)
    session.close()
    work_dir = tmp_path / "work"
    batch = export_batch(database_path=database, work_dir=work_dir)
    candidates = batch / "candidates.jsonl"
    candidates.write_text("reviewed\n", encoding="utf-8")

    with pytest.raises(FileExistsError, match="will not be overwritten"):
        export_batch(database_path=database, work_dir=work_dir)

    assert candidates.read_text(encoding="utf-8") == "reviewed\n"


def test_rejects_nonexistent_meme_id(tmp_path: Path) -> None:
    database = tmp_path / "vault.db"
    session = create_database(database)
    seed_meme(session, 1)
    session.close()
    candidates = write_candidates(tmp_path / "candidates.jsonl", [candidate(999)])

    with pytest.raises(LookupError, match="Meme 999"):
        import_candidates(candidates, database_path=database)


def test_rejects_invalid_candidate_format(tmp_path: Path) -> None:
    path = write_candidates(
        tmp_path / "candidates.jsonl",
        [candidate(1, confidence="high", unexpected=True)],
    )

    with pytest.raises(ValueError, match="Invalid candidate on line 1"):
        load_candidates(path)


def test_protects_manual_and_user_tags_from_removal(tmp_path: Path) -> None:
    database = tmp_path / "vault.db"
    session = create_database(database)
    meme = seed_meme(
        session,
        1,
        tags=(("manual-tag", "manual"), ("user-tag", "user")),
    )
    session.close()
    candidates = write_candidates(
        tmp_path / "candidates.jsonl",
        [candidate(meme.id, remove_tags=["manual-tag", "user-tag"])],
    )

    with pytest.raises(ValueError, match="Cannot remove user/manual tags"):
        import_candidates(candidates, database_path=database)


def test_legacy_tag_candidate_is_submitted_for_review_without_modifying_meme(tmp_path: Path) -> None:
    database = tmp_path / "vault.db"
    session = create_database(database)
    meme = seed_meme(session, 1, tags=(("old", "ai"),))
    session.close()
    candidates = write_candidates(
        tmp_path / "candidates.jsonl",
        [candidate(meme.id, add_tags=["new"], remove_tags=["old"])],
    )

    result = import_candidates(candidates, database_path=database)

    assert result["mode"] == "submitted-for-review"
    assert result["suggestion_count"] == 1
    assert tag_links(database, meme.id) == [("old", "ai", None)]
    assert Path(result["audit_path"]).is_file()
    records = [
        json.loads(line)
        for line in Path(result["audit_path"]).read_text(encoding="utf-8").splitlines()
    ]
    assert records[0]["mode"] == "submitted-for-review"
    assert records[0]["add_tags"] == ["new"]
    session = create_database(database)
    try:
        suggestion = session.scalar(select(MemeEnrichmentSuggestion))
        assert suggestion is not None
        assert suggestion.status == "pending"
        assert json.loads(suggestion.add_tags_json) == ["new"]
        assert json.loads(suggestion.remove_tags_json) == ["old"]
    finally:
        session.close()

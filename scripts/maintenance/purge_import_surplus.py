"""清理误导入到默认 Vault 的 ZIP Import 脏数据。

用法：
    python scripts/maintenance/purge_import_surplus.py --job-id 2            # dry-run
    python scripts/maintenance/purge_import_surplus.py --job-id 2 --apply    # 实际删除

行为：
- 以 import_job_items 中指定 job 的 success 项为准，且仅删除仍归属默认 meme Vault 的 Meme；
- 删除前自动备份数据库（data/backups/）；
- 通过 MemeService.delete_meme 走正规删除链（关系、向量失效、级联、原图与缩略图清理）；
- 输出可审计的结果 JSON（data/backups/purge-<job>-<时间戳>.json）。
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(BASE_DIR))

from app.config import DEFAULT_VAULT_SLUG, DATABASE_PATH  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.models.vault import Vault  # noqa: E402
from app.services.meme_service import MemeNotFoundError, MemeService  # noqa: E402
from app.storage.vault_storage import VaultStorageService  # noqa: E402
from sqlalchemy import text  # noqa: E402


def _load_vault(session, vault_id: int) -> Vault:
    vault = session.get(Vault, vault_id)
    if vault is None:
        raise SystemExit(f"Vault {vault_id} does not exist")
    return vault


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--job-id", type=int, required=True, help="ZIP Import Job ID")
    parser.add_argument("--apply", action="store_true", help="实际执行删除（缺省 dry-run）")
    args = parser.parse_args()

    session = SessionLocal()
    try:
        job = session.execute(
            text("SELECT id, vault_id, original_filename, status, success_count FROM import_jobs WHERE id = :id"),
            {"id": args.job_id},
        ).mappings().first()
        if job is None:
            print(f"Import job {args.job_id} does not exist")
            return 1
        default_vault = session.execute(
            text("SELECT id FROM vaults WHERE slug = :slug"), {"slug": DEFAULT_VAULT_SLUG}
        ).scalar_one()
        if job["vault_id"] != default_vault:
            print(
                f"Import job {args.job_id} targets vault {job['vault_id']}, not the default vault; "
                "nothing to purge"
            )
            return 1

        meme_ids = [
            row[0]
            for row in session.execute(
                text(
                    "SELECT i.meme_id FROM import_job_items i "
                    "JOIN memes m ON m.id = i.meme_id "
                    "WHERE i.job_id = :job_id AND i.status = 'success' AND m.vault_id = :vault_id "
                    "ORDER BY i.meme_id"
                ),
                {"job_id": args.job_id, "vault_id": default_vault},
            )
        ]
        report = {
            "job_id": args.job_id,
            "job_filename": job["original_filename"],
            "mode": "apply" if args.apply else "dry-run",
            "default_vault_id": default_vault,
            "meme_count": len(meme_ids),
            "meme_id_min": meme_ids[0] if meme_ids else None,
            "meme_id_max": meme_ids[-1] if meme_ids else None,
            "deleted": [],
            "missing": [],
            "failed": [],
        }
        print(f"[{report['mode']}] job {args.job_id} ({job['original_filename']}): "
              f"{len(meme_ids)} memes in default vault "
              f"(id {report['meme_id_min']}..{report['meme_id_max']})")

        if not args.apply:
            print("dry-run only; pass --apply to delete")
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 0

        # 写入前备份数据库。
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        backup_dir = DATABASE_PATH.parent / "backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup_path = backup_dir / f"pre-purge-job{args.job_id}-{stamp}.db"
        source = sqlite3.connect(str(DATABASE_PATH))
        target = sqlite3.connect(str(backup_path))
        try:
            source.backup(target)
        finally:
            target.close()
            source.close()
        report["backup"] = str(backup_path)
        print(f"backup written: {backup_path}")

        vault_storage = VaultStorageService()
        storage = vault_storage.storage_for(_load_vault(session, default_vault))
        service = MemeService(session, storage)
        for meme_id in meme_ids:
            try:
                service.delete_meme(meme_id)
                report["deleted"].append(meme_id)
            except MemeNotFoundError:
                report["missing"].append(meme_id)
            except Exception as error:  # noqa: BLE001 - 审计后继续
                report["failed"].append({"meme_id": meme_id, "error": str(error)})

        remaining = session.execute(
            text("SELECT count(*) FROM memes WHERE id IN (SELECT meme_id FROM import_job_items WHERE job_id = :job_id)"),
            {"job_id": args.job_id},
        ).scalar_one()
        report["remaining_memes_from_job"] = remaining
        report_path = backup_dir / f"purge-job{args.job_id}-{stamp}.json"
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"deleted: {len(report['deleted'])}, missing: {len(report['missing'])}, "
              f"failed: {len(report['failed'])}, remaining memes from job: {remaining}")
        print(f"audit report: {report_path}")
        return 0 if not report["failed"] else 2
    finally:
        session.close()


def _load_vault(session, vault_id: int):
    from app.models.vault import Vault

    vault = session.get(Vault, vault_id)
    if vault is None:
        raise SystemExit(f"Vault {vault_id} does not exist")
    return vault


if __name__ == "__main__":
    raise SystemExit(main())

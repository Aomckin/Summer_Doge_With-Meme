import argparse
import json
from pathlib import Path

from app.config import DATABASE_PATH

from .exporter import export_batch
from .importer import import_candidates
from .ui import run_ui


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Offline Meme Vault tag maintenance")
    subparsers = parser.add_subparsers(dest="command", required=True)

    export_parser = subparsers.add_parser("export", help="Export one ID-sorted batch")
    export_parser.add_argument("--database", type=Path, default=DATABASE_PATH)
    export_parser.add_argument("--work-dir", type=Path)
    export_parser.add_argument("--batch", type=int, default=1)
    export_parser.add_argument("--batch-size", type=int, default=10)

    import_parser = subparsers.add_parser("import", help="Validate or apply candidates")
    import_parser.add_argument("candidates", type=Path)
    import_parser.add_argument("--database", type=Path, default=DATABASE_PATH)
    import_parser.add_argument("--apply", action="store_true")
    import_parser.add_argument("--allow-protected-removal", action="store_true")
    import_parser.add_argument("--backup-dir", type=Path)
    import_parser.add_argument("--audit-path", type=Path)

    ui_parser = subparsers.add_parser("ui", help="Open the local maintenance UI")
    ui_parser.add_argument("--database", type=Path, default=DATABASE_PATH)
    ui_parser.add_argument("--work-dir", type=Path)
    ui_parser.add_argument("--port", type=int, default=8765)
    ui_parser.add_argument("--no-browser", action="store_true")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    if args.command == "export":
        batch_dir = export_batch(
            database_path=args.database,
            work_dir=args.work_dir,
            batch_number=args.batch,
            batch_size=args.batch_size,
        )
        print(json.dumps({"batch_dir": str(batch_dir)}, ensure_ascii=False))
        return
    if args.command == "ui":
        run_ui(
            database_path=args.database,
            work_dir=args.work_dir,
            port=args.port,
            open_browser=not args.no_browser,
        )
        return
    result = import_candidates(
        args.candidates,
        database_path=args.database,
        apply=args.apply,
        allow_protected_removal=args.allow_protected_removal,
        backup_dir=args.backup_dir,
        audit_path=args.audit_path,
    )
    print(json.dumps(result, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()

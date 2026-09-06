# 这个模块只负责“项目运行需要的配置值”，不连接数据库，也不处理业务。
import os
from pathlib import Path


# __file__ 是当前 config.py；向上两级得到项目根目录。
# 使用绝对路径后，无论从哪个目录启动程序，data 都会指向同一个位置。
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
IMAGES_DIR = DATA_DIR / "images"
THUMBNAILS_DIR = DATA_DIR / "thumbnails"
TEMPLATE_IMAGES_DIR = DATA_DIR / "template_images"
TEMPLATE_THUMBNAILS_DIR = DATA_DIR / "template_thumbnails"
IMPORT_ARCHIVES_DIR = DATA_DIR / "import_archives"
EXPORT_ARCHIVES_DIR = DATA_DIR / "export_archives"
FRONTEND_DIST_DIR = BASE_DIR / "frontend" / "dist"
AI_SETTINGS_KEY_FILE = DATA_DIR / ".ai_settings.key"
IMAGES_URL_PREFIX = "/media/images"
THUMBNAILS_URL_PREFIX = "/media/thumbnails"
TEMPLATE_IMAGES_URL_PREFIX = "/media/template-images"
TEMPLATE_THUMBNAILS_URL_PREFIX = "/media/template-thumbnails"
DATABASE_PATH = DATA_DIR / "meme_vault.db"

# 单图大小上限默认值（MB）；每个 Vault 可在 config 中覆盖 max_file_size_mb。
DEFAULT_MAX_FILE_SIZE_MB = 100

# 默认 Vault 承载 v2.0 之前的全部数据；storage_path 为空表示沿用旧共享目录。
# 常量放在 config 是为了避免 database 与 models 之间的循环导入。
DEFAULT_VAULT_SLUG = "meme"
DEFAULT_VAULT_NAME = "暗苟，夏，Meme"

# 部署时可以用环境变量替换数据库；本地开发则自动使用 SQLite 文件。
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"sqlite:///{DATABASE_PATH.as_posix()}",
)

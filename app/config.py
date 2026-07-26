# 这个模块只负责“项目运行需要的配置值”，不连接数据库，也不处理业务。
import os
from pathlib import Path


# __file__ 是当前 config.py；向上两级得到项目根目录。
# 使用绝对路径后，无论从哪个目录启动程序，data 都会指向同一个位置。
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
IMAGES_DIR = DATA_DIR / "images"
THUMBNAILS_DIR = DATA_DIR / "thumbnails"
FRONTEND_DIST_DIR = BASE_DIR / "frontend" / "dist"
IMAGES_URL_PREFIX = "/media/images"
THUMBNAILS_URL_PREFIX = "/media/thumbnails"
DATABASE_PATH = DATA_DIR / "meme_vault.db"

# 部署时可以用环境变量替换数据库；本地开发则自动使用 SQLite 文件。
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"sqlite:///{DATABASE_PATH.as_posix()}",
)

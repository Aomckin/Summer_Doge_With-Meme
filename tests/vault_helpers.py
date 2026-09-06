from app.models.vault import Vault


def ensure_default_vault(session) -> Vault:
    """测试库需要手动创建默认 meme Vault（真实环境由启动迁移完成）。"""
    vault = session.query(Vault).filter_by(slug="meme").one_or_none()
    if vault is None:
        vault = Vault(name="Meme", slug="meme", type="meme", profile="meme")
        session.add(vault)
        session.commit()
        session.refresh(vault)
    return vault

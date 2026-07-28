from collections.abc import Mapping

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.template import Template


class TemplateRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    @staticmethod
    def normalize_name(name: str) -> str:
        return name.strip().lower()

    def create(self, template: Template) -> Template:
        self.session.add(template)
        self.session.flush()
        self.session.refresh(template)
        return template

    def get_by_id(self, template_id: int) -> Template | None:
        return self.session.get(Template, template_id)

    def get_by_name(self, name: str) -> Template | None:
        normalized = self.normalize_name(name)
        return self.session.scalar(
            select(Template).where(func.lower(Template.name) == normalized)
        )

    def list(self, *, limit: int | None = None) -> list[Template]:
        statement = select(Template).order_by(Template.id)
        if limit is not None:
            statement = statement.limit(limit)
        return list(self.session.scalars(statement))

    def update(
        self,
        template: Template,
        changes: Mapping[str, object],
    ) -> Template:
        for field, value in changes.items():
            setattr(template, field, value)
        self.session.flush()
        self.session.refresh(template)
        return template

    def delete(self, template: Template) -> None:
        self.session.delete(template)
        self.session.flush()

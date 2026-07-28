from sqlalchemy import select, update
from sqlalchemy.orm import Session, joinedload

from app.models.ai_settings import AIModel, AIProvider


class AISettingsRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list_providers(self) -> list[AIProvider]:
        return list(
            self.session.scalars(select(AIProvider).order_by(AIProvider.name))
        )

    def get_provider(self, provider_id: int) -> AIProvider | None:
        return self.session.get(AIProvider, provider_id)

    def create_provider(self, **values: object) -> AIProvider:
        provider = AIProvider(**values)
        self.session.add(provider)
        self.session.flush()
        return provider

    def list_models(self) -> list[AIModel]:
        return list(
            self.session.scalars(
                select(AIModel)
                .options(joinedload(AIModel.provider))
                .order_by(AIModel.provider_id, AIModel.display_name)
            )
        )

    def get_model(self, model_id: int) -> AIModel | None:
        return self.session.scalar(
            select(AIModel)
            .options(joinedload(AIModel.provider))
            .where(AIModel.id == model_id)
        )

    def get_model_by_external_id(
        self,
        provider_id: int,
        external_id: str,
    ) -> AIModel | None:
        return self.session.scalar(
            select(AIModel).where(
                AIModel.provider_id == provider_id,
                AIModel.model_id == external_id,
            )
        )

    def create_model(self, **values: object) -> AIModel:
        model = AIModel(**values)
        self.session.add(model)
        self.session.flush()
        return model

    def active_model(self) -> AIModel | None:
        return self.session.scalar(
            select(AIModel)
            .options(joinedload(AIModel.provider))
            .where(AIModel.is_active.is_(True))
        )

    def clear_active_models(self) -> None:
        self.session.execute(
            update(AIModel)
            .where(AIModel.is_active.is_(True))
            .values(is_active=False)
        )

    def active_embedding_model(self) -> AIModel | None:
        return self.session.scalar(
            select(AIModel)
            .options(joinedload(AIModel.provider))
            .where(AIModel.is_embedding_active.is_(True))
        )

    def clear_active_embedding_models(self) -> None:
        self.session.execute(
            update(AIModel)
            .where(AIModel.is_embedding_active.is_(True))
            .values(is_embedding_active=False)
        )

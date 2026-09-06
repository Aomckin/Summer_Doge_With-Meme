from app.services.semantic_search_service import SemanticSearchService


def build_scene_query(context: str, response_intent: str | None = None) -> str:
    normalized_context = context.strip()
    normalized_intent = response_intent.strip() if response_intent else ""
    if not normalized_context:
        raise ValueError("context must not be empty")
    if normalized_intent:
        return (
            f"回应意图（优先匹配）：\n{normalized_intent}\n\n"
            f"聊天场景：\n{normalized_context}"
        )
    return (
        f"聊天场景：\n{normalized_context}\n\n"
        "请检索最适合作为当前聊天回应的 Reaction Meme。"
    )


class ChatRecommendationService:
    def __init__(self, semantic_search: SemanticSearchService) -> None:
        self.semantic_search = semantic_search

    def recommend(
        self,
        *,
        context: str,
        response_intent: str | None,
        page: int,
        page_size: int,
        vault_id: int | None = None,
    ) -> dict[str, object]:
        return self.semantic_search.search(
            query=build_scene_query(context, response_intent),
            tags=[],
            template_id=None,
            page=page,
            page_size=page_size,
            vault_id=vault_id,
        )

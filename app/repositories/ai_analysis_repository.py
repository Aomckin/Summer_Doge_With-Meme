import json
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.ai_analysis import MemeAIAnalysis
from app.models.meme import Meme


class AIAnalysisRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def create(
        self,
        meme: Meme,
        *,
        model_name: str,
        description: str,
        suggestions: Sequence[dict[str, object]],
    ) -> MemeAIAnalysis:
        analysis = MemeAIAnalysis(
            meme=meme,
            model_name=model_name,
            description=description,
            suggestions_json=json.dumps(
                list(suggestions),
                ensure_ascii=False,
                separators=(",", ":"),
            ),
        )
        self.session.add(analysis)
        self.session.flush()
        return analysis

    def get_for_meme(
        self,
        meme_id: int,
        analysis_id: int,
    ) -> MemeAIAnalysis | None:
        return self.session.scalar(
            select(MemeAIAnalysis).where(
                MemeAIAnalysis.id == analysis_id,
                MemeAIAnalysis.meme_id == meme_id,
            )
        )

    @staticmethod
    def load_suggestions(
        analysis: MemeAIAnalysis,
    ) -> list[dict[str, object]]:
        value = json.loads(analysis.suggestions_json)
        if not isinstance(value, list):
            raise ValueError("Stored AI suggestions are invalid")
        return value

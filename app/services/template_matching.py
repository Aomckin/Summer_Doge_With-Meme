from dataclasses import dataclass
from math import sqrt
from collections.abc import Iterable, Sequence


TOP_TEMPLATE_IMAGE_CANDIDATES = 10


@dataclass(frozen=True)
class VisualTemplateCandidate:
    template_id: int
    similarity: float


def rank_visual_templates(
    query: Sequence[float],
    vectors: Iterable[tuple[int, Sequence[float]]],
) -> list[VisualTemplateCandidate]:
    query_norm = sqrt(sum(value * value for value in query))
    if not query_norm:
        return []
    ranked: list[VisualTemplateCandidate] = []
    for template_id, vector in vectors:
        if len(vector) != len(query):
            continue
        vector_norm = sqrt(sum(value * value for value in vector))
        if not vector_norm:
            continue
        similarity = sum(left * right for left, right in zip(query, vector, strict=True)) / (query_norm * vector_norm)
        ranked.append(VisualTemplateCandidate(template_id, similarity))
    return sorted(ranked, key=lambda item: (-item.similarity, item.template_id))[:TOP_TEMPLATE_IMAGE_CANDIDATES]

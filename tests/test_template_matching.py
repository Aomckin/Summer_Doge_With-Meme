from app.services.template_matching import rank_visual_templates


def test_rank_visual_templates_uses_cosine_similarity_and_top_ten() -> None:
    vectors = [(index, (1.0, float(index))) for index in range(12)]

    ranked = rank_visual_templates((1.0, 10.0), vectors)

    assert [item.template_id for item in ranked] == [10, 11, 9, 8, 7, 6, 5, 4, 3, 2]


def test_rank_visual_templates_skips_wrong_dimensions_and_zero_vectors() -> None:
    ranked = rank_visual_templates((1.0, 0.0), [(1, (0.0, 0.0)), (2, (1.0,)), (3, (1.0, 0.0))])

    assert [(item.template_id, item.similarity) for item in ranked] == [(3, 1.0)]

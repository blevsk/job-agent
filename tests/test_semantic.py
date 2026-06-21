from src.models import JobOffer
from src.semantic import _cosine, _offer_to_text, enrich_with_semantic


class FakeModel:
    """Mock d'un encoder : renvoie un vecteur déterministe par hash du texte."""

    def __init__(self, vectors_by_text):
        self.vectors_by_text = vectors_by_text

    def encode(self, texts, **kwargs):
        return [self.vectors_by_text[t] for t in texts]


def make_offer(id_, title, snippet="", location=None, contract_type=None):
    return JobOffer(
        id=id_,
        title=title,
        snippet=snippet,
        location=location,
        contract_type=contract_type,
        url=f"x/{id_}",
    )


def test_cosine_identical_vectors_returns_one():
    assert _cosine([1.0, 0.0, 0.0], [1.0, 0.0, 0.0]) == 1.0


def test_cosine_orthogonal_returns_zero():
    assert _cosine([1.0, 0.0], [0.0, 1.0]) == 0.0


def test_cosine_handles_zero_vector():
    assert _cosine([0.0, 0.0], [1.0, 1.0]) == 0.0


def test_offer_to_text_concatenates_fields():
    offer = make_offer(
        "x",
        "Assistant",
        snippet="Tâches admin",
        location="Lille",
        contract_type="Alternance",
    )
    text = _offer_to_text(offer)
    assert "Assistant" in text
    assert "Alternance" in text
    assert "Lille" in text
    assert "Tâches admin" in text


def test_enrich_assigns_scores_clamped_to_unit_interval():
    profile = "alternance administratif"
    o1 = make_offer("a", "alternance assistant", "tâches administratives")
    o2 = make_offer("b", "développeur senior C++")

    vectors = {
        profile: [1.0, 0.0],
        _offer_to_text(o1): [0.9, 0.1],  # ~aligned
        _offer_to_text(o2): [-1.0, 0.0],  # opposite (will be clamped to 0)
    }
    enrich_with_semantic([o1, o2], profile, model=FakeModel(vectors))

    assert o1.semantic_score is not None and o1.semantic_score > 0.9
    assert o2.semantic_score == 0.0  # clamped


def test_enrich_skips_when_profile_empty():
    o = make_offer("a", "Foo")
    enrich_with_semantic([o], "   ", model=FakeModel({}))
    assert o.semantic_score is None


def test_enrich_skips_when_offers_empty():
    # ne doit pas tenter de charger le modèle ni planter
    enrich_with_semantic([], "profil", model=FakeModel({}))

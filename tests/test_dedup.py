from src.dedup import _normalize_location, _normalize_title, dedupe_offers
from src.models import JobOffer


def make(id_, title, location, posted_days_ago=5):
    return JobOffer(
        id=id_,
        title=title,
        location=location,
        posted_days_ago=posted_days_ago,
        url=f"x/{id_}",
    )


def test_normalize_title_strips_gender_markers():
    assert _normalize_title("Assistant Administratif (H/F)") == "assistant administratif"
    assert _normalize_title("Assistant Administratif (F/H) (H/F)") == "assistant administratif"
    assert _normalize_title("Vendeur H/F") == "vendeur"
    assert (
        _normalize_title("Chef de Projets Partenariats F/H (H/F)") == "chef de projets partenariats"
    )


def test_normalize_title_strips_accents_and_case():
    assert _normalize_title("Sécrétaire Médicale") == "secretaire medicale"


def test_normalize_location_strips_department_prefix():
    assert _normalize_location("59 - Roubaix") == "roubaix"
    assert _normalize_location("75 - PARIS 17") == "paris 17"
    assert _normalize_location(None) == ""
    assert _normalize_location("Villeneuve-d'Ascq") == "villeneuve d ascq"


def test_dedupe_merges_gender_variants():
    offers = [
        make(
            "a",
            "Alternance Assistant Administratif - Roubaix (F/H) (H/F)",
            "59 - Roubaix",
            posted_days_ago=23,
        ),
        make(
            "b",
            "Alternance Assistant Administratif - Roubaix (H/F)",
            "59 - Roubaix",
            posted_days_ago=24,
        ),
    ]
    result = dedupe_offers(offers)
    assert len(result) == 1
    # La plus récente (23j) est gardée
    assert result[0].id == "a"


def test_dedupe_keeps_freshest():
    offers = [
        make("old", "Vendeur (H/F)", "59 - Lille", posted_days_ago=20),
        make("new", "Vendeur (F/H)", "59 - LILLE", posted_days_ago=2),
        make("mid", "Vendeur H/F", "59 - Lille", posted_days_ago=10),
    ]
    result = dedupe_offers(offers)
    assert [o.id for o in result] == ["new"]


def test_dedupe_preserves_distinct_offers():
    offers = [
        make("a", "Assistant administratif", "59 - Roubaix"),
        make("b", "Assistant administratif", "59 - Lille"),  # lieu différent
        make("c", "Assistant qualité", "59 - Roubaix"),  # titre différent
    ]
    result = dedupe_offers(offers)
    assert {o.id for o in result} == {"a", "b", "c"}


def test_dedupe_handles_missing_dates():
    offers = [
        make("a", "Foo (H/F)", "Lille", posted_days_ago=None),
        make("b", "Foo (F/H)", "Lille", posted_days_ago=3),
    ]
    result = dedupe_offers(offers)
    assert [o.id for o in result] == ["b"]

from src.models import JobOffer, KeywordWeight, ScoringConfig
from src.scoring import score_offer, score_offers


def make_offer(**kwargs) -> JobOffer:
    base = {
        "id": "abc",
        "title": "Assistant Administratif en Alternance",
        "company": "Acme",
        "location": "Villeneuve-d'Ascq (59)",
        "contract_type": "Alternance",
        "snippet": "Contrat d'alternance, tâches administratives",
        "posted_days_ago": 2,
        "url": "https://example.com/jk=abc",
    }
    base.update(kwargs)
    return JobOffer(**base)


def test_keyword_match_adds_weight():
    config = ScoringConfig(
        keywords=[
            KeywordWeight(pattern="alternance", weight=5.0),
            KeywordWeight(pattern="administratif", weight=3.0),
            KeywordWeight(pattern="data scientist", weight=10.0),
        ]
    )
    result = score_offer(make_offer(), config)
    assert result.score_breakdown["keywords"] == 8.0


def test_contract_bonus():
    config = ScoringConfig(preferred_contracts={"Alternance": 5.0, "Stage": -10.0})
    result = score_offer(make_offer(contract_type="Alternance"), config)
    assert result.score_breakdown["contract"] == 5.0
    result2 = score_offer(make_offer(contract_type="Stage"), config)
    assert result2.score_breakdown["contract"] == -10.0


def test_location_bonus_case_insensitive():
    config = ScoringConfig(preferred_location="villeneuve", location_bonus=3.0)
    result = score_offer(make_offer(), config)
    assert result.score_breakdown["location"] == 3.0


def test_location_no_match():
    config = ScoringConfig(preferred_location="Paris", location_bonus=3.0)
    result = score_offer(make_offer(), config)
    assert result.score_breakdown["location"] == 0.0


def test_freshness_bonus_applies_within_window():
    config = ScoringConfig(freshness_bonus=2.0, freshness_max_days=7)
    assert score_offer(make_offer(posted_days_ago=2), config).score_breakdown["freshness"] == 2.0
    assert score_offer(make_offer(posted_days_ago=10), config).score_breakdown["freshness"] == 0.0
    assert score_offer(make_offer(posted_days_ago=None), config).score_breakdown["freshness"] == 0.0


def test_total_score_is_sum_of_breakdown():
    config = ScoringConfig(
        keywords=[KeywordWeight(pattern="alternance", weight=5.0)],
        preferred_contracts={"Alternance": 5.0},
        preferred_location="Villeneuve",
        location_bonus=3.0,
        freshness_bonus=2.0,
    )
    result = score_offer(make_offer(), config)
    assert result.score == 5.0 + 5.0 + 3.0 + 2.0


def test_rome_score_matches_code():
    config = ScoringConfig(rome_codes={"M1607": 5.0, "M1602": 3.0})
    result = score_offer(make_offer(rome_code="M1607"), config)
    assert result.score_breakdown["rome"] == 5.0
    result2 = score_offer(make_offer(rome_code="M1602"), config)
    assert result2.score_breakdown["rome"] == 3.0


def test_rome_score_unknown_returns_zero():
    config = ScoringConfig(rome_codes={"M1607": 5.0})
    result = score_offer(make_offer(rome_code="X9999"), config)
    assert result.score_breakdown["rome"] == 0.0
    result2 = score_offer(make_offer(rome_code=None), config)
    assert result2.score_breakdown["rome"] == 0.0


def test_score_offers_sorts_descending():
    config = ScoringConfig(
        keywords=[KeywordWeight(pattern="alternance", weight=5.0)],
    )
    offers = [
        make_offer(id="low", title="Stage marketing", snippet="stage"),
        make_offer(id="high", title="Alternance dev", snippet="alternance python"),
    ]
    scored = score_offers(offers, config)
    assert [s.offer.id for s in scored] == ["high", "low"]

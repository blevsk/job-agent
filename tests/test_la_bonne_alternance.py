import json
from pathlib import Path

from src.la_bonne_alternance import _clean_snippet, _days_since, map_offer

FIXTURE = Path(__file__).parent / "fixtures" / "lba_search.json"


def _jobs() -> list[dict]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))["jobs"]


def test_parse_skips_filled_and_invalid():
    jobs = _jobs()
    offers = [map_offer(j) for j in jobs]
    valid = [o for o in offers if o is not None]
    assert len(valid) == 1
    assert valid[0].id == "lba_abc-001"


def test_id_prefixed_with_lba():
    offer = map_offer(_jobs()[0])
    assert offer is not None
    assert offer.id == "lba_abc-001"


def test_contract_type_is_always_alternance():
    offer = map_offer(_jobs()[0])
    assert offer is not None
    assert offer.contract_type == "Alternance"


def test_company_from_brand():
    offer = map_offer(_jobs()[0])
    assert offer is not None
    assert offer.company == "Beta Corp"


def test_location_from_workplace():
    offer = map_offer(_jobs()[0])
    assert offer is not None
    assert offer.location == "Lille, 59000"


def test_rome_code_first_entry():
    offer = map_offer(_jobs()[0])
    assert offer is not None
    assert offer.rome_code == "M1203"


def test_apply_url_preserved():
    offer = map_offer(_jobs()[0])
    assert offer is not None
    assert "labonnealternance" in offer.url


def test_filled_offer_returns_none():
    filled = _jobs()[1]
    assert map_offer(filled) is None


def test_missing_id_returns_none():
    no_id = _jobs()[2]
    assert map_offer(no_id) is None


def test_missing_title_returns_none():
    no_title = _jobs()[3]
    assert map_offer(no_title) is None


def test_days_since_future_date_returns_zero():
    assert _days_since("2099-01-01T08:00:00.000Z") == 0


def test_days_since_none_returns_none():
    assert _days_since(None) is None


def test_days_since_invalid_returns_none():
    assert _days_since("not-a-date") is None


def test_clean_snippet_truncates():
    long_text = "x" * 500
    result = _clean_snippet(long_text)
    assert result is not None
    assert len(result) <= 400
    assert result.endswith("…")


def test_clean_snippet_none_returns_none():
    assert _clean_snippet(None) is None


def test_clean_snippet_short_text_unchanged():
    assert _clean_snippet("bonjour") == "bonjour"

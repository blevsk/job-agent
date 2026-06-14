import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from src.france_travail import (
    MissingCredentialsError,
    _clean_snippet,
    _days_since,
    _normalize_contract,
    get_credentials,
    map_offer,
    parse_search_response,
)

FIXTURE = Path(__file__).parent / "fixtures" / "france_travail_search.json"


def test_parse_search_response_skips_invalid_entries():
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    offers = parse_search_response(payload)
    ids = {o.id for o in offers}
    # L'offre 0004 sans intitulé doit être ignorée
    assert ids == {"0001", "0002", "0003", "0005"}


def test_alternance_flag_takes_priority():
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    offers = {o.id: o for o in parse_search_response(payload)}
    # 0001 : typeContrat=CDD mais alternance=true → Alternance
    assert offers["0001"].contract_type == "Alternance"


def test_alternance_inferred_from_nature_label():
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    offers = {o.id: o for o in parse_search_response(payload)}
    # 0005 : pas de flag mais natureContrat="Contrat de professionnalisation"
    assert offers["0005"].contract_type == "Alternance"


def test_normalize_contract_priorities():
    assert _normalize_contract("CDD", "Contrat travail", alternance_flag=True) == "Alternance"
    assert _normalize_contract("CDD", "Contrat apprentissage") == "Alternance"
    assert _normalize_contract("CDD", "Contrat de professionnalisation") == "Alternance"
    assert _normalize_contract("CDI", "Contrat travail") == "CDI"
    assert _normalize_contract("CDD", "Contrat travail") == "CDD"
    assert _normalize_contract("MIS", None) == "Intérim"
    assert _normalize_contract("SAI", None) == "Saisonnier"
    assert _normalize_contract(None, None) is None


def test_map_offer_extracts_fields():
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    raw = payload["resultats"][0]
    offer = map_offer(raw)
    assert offer is not None
    assert offer.id == "0001"
    assert "Alternance" in offer.title
    assert offer.company == "Acme SAS"
    assert offer.location and "VILLENEUVE" in offer.location
    assert offer.contract_type == "Alternance"
    assert offer.salary and "800" in offer.salary
    assert offer.url == "https://candidat.francetravail.fr/offres/recherche/detail/0001"
    assert offer.rome_code == "M1607"


def test_map_offer_constructs_url_when_missing():
    raw = {
        "id": "9999",
        "intitule": "Test",
        "dateCreation": "2099-01-01T00:00:00.000Z",
    }
    offer = map_offer(raw)
    assert offer is not None
    assert offer.url == "https://candidat.francetravail.fr/offres/recherche/detail/9999"


def test_days_since_recent_date():
    five_days_ago = (datetime.now(timezone.utc) - timedelta(days=5)).isoformat()
    assert _days_since(five_days_ago) == 5
    assert _days_since(None) is None
    assert _days_since("not-a-date") is None


def test_clean_snippet_truncates_and_normalizes_whitespace():
    raw = "Première ligne.\n\nDeuxième    ligne.\nTroisième."
    assert _clean_snippet(raw) == "Première ligne. Deuxième ligne. Troisième."
    long = "x" * 500
    out = _clean_snippet(long, max_chars=100)
    assert out is not None
    assert len(out) == 100
    assert out.endswith("…")


def test_get_credentials_missing_raises(tmp_path, monkeypatch):
    monkeypatch.delenv("FRANCE_TRAVAIL_CLIENT_ID", raising=False)
    monkeypatch.delenv("FRANCE_TRAVAIL_CLIENT_SECRET", raising=False)
    empty_env = tmp_path / ".env"
    empty_env.write_text("# empty\n")
    with pytest.raises(MissingCredentialsError):
        get_credentials(empty_env)


def test_get_credentials_loads_from_dotenv(tmp_path, monkeypatch):
    monkeypatch.delenv("FRANCE_TRAVAIL_CLIENT_ID", raising=False)
    monkeypatch.delenv("FRANCE_TRAVAIL_CLIENT_SECRET", raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text(
        'FRANCE_TRAVAIL_CLIENT_ID="abc"\n'
        "FRANCE_TRAVAIL_CLIENT_SECRET=secret-xyz\n"
    )
    cid, csec = get_credentials(env_file)
    assert cid == "abc"
    assert csec == "secret-xyz"

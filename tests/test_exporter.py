import json

from src.exporter import export_json, serialize
from src.models import JobOffer, ScoredOffer


def make_scored(id_="abc", title="Développeur", score=7.5) -> ScoredOffer:
    offer = JobOffer(id=id_, title=title, url=f"https://example.com/{id_}")
    return ScoredOffer(
        offer=offer,
        score=score,
        score_breakdown={"keywords": 5.0, "freshness": 2.5},
    )


def test_serialize_includes_meta_total():
    result = serialize([make_scored()], {"source": "france_travail"})
    assert result["meta"]["source"] == "france_travail"
    assert result["meta"]["total"] == 1


def test_serialize_flattens_offer_fields():
    result = serialize([make_scored()], {})
    offer_dict = result["offers"][0]
    assert offer_dict["id"] == "abc"
    assert offer_dict["title"] == "Développeur"
    assert offer_dict["score"] == 7.5
    assert offer_dict["score_breakdown"] == {"keywords": 5.0, "freshness": 2.5}


def test_serialize_empty_list():
    result = serialize([], {"source": "test"})
    assert result["meta"]["total"] == 0
    assert result["offers"] == []


def test_export_json_writes_file(tmp_path):
    output = tmp_path / "offers.json"
    export_json([make_scored()], output, {"source": "test"})
    assert output.exists()
    data = json.loads(output.read_text(encoding="utf-8"))
    assert data["meta"]["total"] == 1
    assert data["offers"][0]["id"] == "abc"


def test_export_json_creates_parent_dirs(tmp_path):
    output = tmp_path / "nested" / "deep" / "offers.json"
    export_json([], output, {})
    assert output.exists()


def test_export_json_valid_json_encoding(tmp_path):
    output = tmp_path / "offers.json"
    scored = make_scored(title="Développeur — Île-de-France")
    export_json([scored], output, {})
    data = json.loads(output.read_text(encoding="utf-8"))
    assert "Île-de-France" in data["offers"][0]["title"]

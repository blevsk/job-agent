import io
import json
import sys

import pytest

import scripts.apply_profile_config as sut


def run(body: str, tmp_path, monkeypatch) -> int:
    monkeypatch.setattr(sut, "ROOT", tmp_path)
    monkeypatch.setattr("sys.stdin", io.StringIO(body))
    return sut.main()


def test_valid_profile_creates_directory(tmp_path, monkeypatch):
    body = json.dumps({"profileId": "testprofile", "poste": "Développeur"})
    code = run(body, tmp_path, monkeypatch)
    assert code == 0
    assert (tmp_path / "profiles" / "testprofile").is_dir()


def test_meta_json_written(tmp_path, monkeypatch):
    body = json.dumps({"profileId": "p1", "poste": "Ingénieur"})
    run(body, tmp_path, monkeypatch)
    meta = json.loads((tmp_path / "profiles" / "p1" / "meta.json").read_text())
    assert meta["label"] == "Ingénieur"


def test_profile_md_written(tmp_path, monkeypatch):
    body = json.dumps({"profileId": "p2", "profileMd": "Mon profil en markdown."})
    run(body, tmp_path, monkeypatch)
    content = (tmp_path / "profiles" / "p2" / "profile.md").read_text()
    assert content == "Mon profil en markdown."


def test_search_config_written(tmp_path, monkeypatch):
    cfg = {"defaults": {"location": "Lille"}, "searches": []}
    body = json.dumps({"profileId": "p3", "searchConfig": cfg})
    run(body, tmp_path, monkeypatch)
    written = json.loads((tmp_path / "profiles" / "p3" / "search.config.json").read_text())
    assert written["defaults"]["location"] == "Lille"


def test_scoring_config_written(tmp_path, monkeypatch):
    cfg = {"keywords": [{"pattern": "python", "weight": 5.0}]}
    body = json.dumps({"profileId": "p4", "scoringConfig": cfg})
    run(body, tmp_path, monkeypatch)
    written = json.loads((tmp_path / "profiles" / "p4" / "scoring.config.json").read_text())
    assert written["keywords"][0]["pattern"] == "python"


def test_absent_fields_not_written(tmp_path, monkeypatch):
    body = json.dumps({"profileId": "p5"})
    run(body, tmp_path, monkeypatch)
    profile_dir = tmp_path / "profiles" / "p5"
    assert not (profile_dir / "profile.md").exists()
    assert not (profile_dir / "meta.json").exists()


def test_invalid_json_returns_error(tmp_path, monkeypatch, capsys):
    code = run("not json", tmp_path, monkeypatch)
    assert code == 1


def test_missing_profile_id_returns_error(tmp_path, monkeypatch):
    body = json.dumps({"poste": "Dev"})
    code = run(body, tmp_path, monkeypatch)
    assert code == 1


def test_profile_id_with_special_chars_returns_error(tmp_path, monkeypatch):
    body = json.dumps({"profileId": "invalid-id!"})
    code = run(body, tmp_path, monkeypatch)
    assert code == 1


def test_profile_id_too_long_returns_error(tmp_path, monkeypatch):
    body = json.dumps({"profileId": "a" * 33})
    code = run(body, tmp_path, monkeypatch)
    assert code == 1


def test_profile_id_max_length_valid(tmp_path, monkeypatch):
    body = json.dumps({"profileId": "a" * 32})
    code = run(body, tmp_path, monkeypatch)
    assert code == 0

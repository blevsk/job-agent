import json
from types import SimpleNamespace

from src.models import JobOffer
from src.rerank import _build_user_message, _extract_json, llm_rerank


class FakeAnthropic:
    """Mock minimal du client anthropic — capture l'appel et renvoie un texte fixe."""

    def __init__(self, response_text):
        self.response_text = response_text
        self.calls = []
        self.messages = self

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(content=[SimpleNamespace(text=self.response_text)])


def make_offer(id_, title="t"):
    return JobOffer(id=id_, title=title, url=f"x/{id_}")


def test_extract_json_handles_raw():
    assert _extract_json('{"ranking": []}') == {"ranking": []}


def test_extract_json_strips_code_fence():
    payload = '```json\n{"ranking": [{"id": "a", "rank": 1, "reason": "ok"}]}\n```'
    assert _extract_json(payload) == {"ranking": [{"id": "a", "rank": 1, "reason": "ok"}]}


def test_extract_json_picks_first_object_from_chatty_response():
    payload = 'Voici le résultat : {"ranking": [{"id": "x", "rank": 1, "reason": "match"}]} merci'
    assert _extract_json(payload)["ranking"][0]["id"] == "x"


def test_build_user_message_includes_profile_and_offers():
    offers = [make_offer("a", "Alternance"), make_offer("b", "Stage")]
    msg = _build_user_message("Mon profil", offers)
    assert "Mon profil" in msg
    assert '"id": "a"' in msg
    assert '"id": "b"' in msg


def test_llm_rerank_assigns_rank_and_reason():
    offers = [make_offer("a"), make_offer("b"), make_offer("c")]
    fake = FakeAnthropic(json.dumps({
        "ranking": [
            {"id": "b", "rank": 1, "reason": "Match parfait sur l'alternance et le lieu."},
            {"id": "a", "rank": 2, "reason": "Bon profil mais lieu éloigné."},
            {"id": "c", "rank": 3, "reason": "Pas d'alternance."},
        ],
    }))
    result = llm_rerank(offers, "Mon profil", client=fake)
    by_id = {o.id: o for o in result}
    assert by_id["b"].llm_rank == 1
    assert by_id["a"].llm_rank == 2
    assert by_id["c"].llm_rank == 3
    assert "Match parfait" in by_id["b"].llm_reason
    assert len(fake.calls) == 1
    assert fake.calls[0]["model"].startswith("claude-haiku")


def test_llm_rerank_skips_without_client_or_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    offer = make_offer("a")
    result = llm_rerank([offer], "profile")
    assert result[0].llm_rank is None
    assert result[0].llm_reason is None


def test_llm_rerank_skips_empty_profile():
    offer = make_offer("a")
    fake = FakeAnthropic("{}")
    llm_rerank([offer], "   ", client=fake)
    assert offer.llm_rank is None
    assert fake.calls == []


def test_llm_rerank_ignores_unknown_ids_from_llm():
    offers = [make_offer("a"), make_offer("b")]
    fake = FakeAnthropic(json.dumps({"ranking": [
        {"id": "a", "rank": 1, "reason": "ok"},
        {"id": "ghost", "rank": 2, "reason": "fantôme"},
    ]}))
    llm_rerank(offers, "profile", client=fake)
    assert offers[0].llm_rank == 1
    assert offers[1].llm_rank is None  # 'b' n'apparaît pas dans le ranking

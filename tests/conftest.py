import pytest

from src.models import JobOffer


@pytest.fixture
def make_offer():
    def _factory(**kwargs):
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

    return _factory

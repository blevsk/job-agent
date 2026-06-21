"""Calcul de similarité sémantique profil ↔ offre via sentence-transformers.

Modèle utilisé : `paraphrase-multilingual-MiniLM-L12-v2` (~120MB, multilingue FR/EN,
CPU friendly, rapide). Téléchargé à la 1re utilisation et caché dans
`~/.cache/huggingface/` (le workflow GitHub Action cache ce dossier).
"""

from __future__ import annotations

from typing import Protocol

from .models import JobOffer

DEFAULT_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"


class EmbeddingModel(Protocol):
    """Interface minimale qu'on attend d'un encoder (compatible avec sentence-transformers
    et avec n'importe quel mock pour les tests)."""

    def encode(self, texts: list[str], **kwargs) -> object: ...


def load_default_model(name: str = DEFAULT_MODEL) -> EmbeddingModel:
    """Import paresseux : on ne charge sentence-transformers que si on s'en sert
    (évite de pénaliser les tests qui n'en ont pas besoin)."""
    from sentence_transformers import SentenceTransformer  # noqa: I001

    return SentenceTransformer(name)


def _offer_to_text(offer: JobOffer) -> str:
    parts = [
        offer.title or "",
        offer.contract_type or "",
        offer.location or "",
        offer.snippet or "",
    ]
    return " — ".join(p for p in parts if p)


def _cosine(a, b) -> float:
    import numpy as np  # noqa: I001

    a = np.asarray(a, dtype=np.float32)
    b = np.asarray(b, dtype=np.float32)
    na = float(np.linalg.norm(a))
    nb = float(np.linalg.norm(b))
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def enrich_with_semantic(
    offers: list[JobOffer],
    profile_text: str,
    model: EmbeddingModel | None = None,
) -> list[JobOffer]:
    """Calcule la similarité cosine entre le profil et chaque offre,
    écrit le résultat (clampé à [0, 1]) dans `offer.semantic_score`."""
    if not offers or not profile_text.strip():
        return offers

    if model is None:
        model = load_default_model()

    texts = [profile_text] + [_offer_to_text(o) for o in offers]
    embeddings = model.encode(texts, show_progress_bar=False)

    profile_emb = embeddings[0]
    for offer, emb in zip(offers, embeddings[1:]):
        score = _cosine(profile_emb, emb)
        # Cosine peut être légèrement négatif ; on clamp à [0, 1] pour rester
        # interprétable comme un % de match.
        offer.semantic_score = max(0.0, min(1.0, score))

    return offers

from __future__ import annotations

from pydantic import BaseModel, Field


class JobOffer(BaseModel):
    id: str
    title: str
    company: str | None = None
    location: str | None = None
    contract_type: str | None = None
    salary: str | None = None
    posted_days_ago: int | None = None
    snippet: str | None = None
    url: str
    rome_code: str | None = None
    semantic_score: float | None = None  # cosine similarity profil ↔ offre (0..1)
    llm_rank: int | None = None  # rang assigné par le re-rank LLM (1 = meilleur)
    llm_reason: str | None = None  # justification courte du LLM


class KeywordWeight(BaseModel):
    pattern: str
    weight: float


class ScoringConfig(BaseModel):
    keywords: list[KeywordWeight] = Field(default_factory=list)
    preferred_contracts: dict[str, float] = Field(default_factory=dict)
    rome_codes: dict[str, float] = Field(default_factory=dict)
    preferred_location: str | None = None
    location_bonus: float = 3.0
    freshness_bonus: float = 2.0
    freshness_max_days: int = 7
    # Poids appliqué à la similarité cosine (0..1) → contribution semantic au score total.
    # 10 signifie "+10 si l'offre est parfaitement alignée avec le profil".
    semantic_weight: float = 10.0


class ScoredOffer(BaseModel):
    offer: JobOffer
    score: float
    score_breakdown: dict[str, float]

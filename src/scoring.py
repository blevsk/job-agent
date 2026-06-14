from __future__ import annotations

import re

from .models import JobOffer, ScoredOffer, ScoringConfig


def _keyword_score(offer: JobOffer, config: ScoringConfig) -> float:
    if not config.keywords:
        return 0.0
    haystack = f"{offer.title or ''} {offer.snippet or ''}"
    total = 0.0
    for kw in config.keywords:
        if re.search(kw.pattern, haystack, re.IGNORECASE):
            total += kw.weight
    return total


def _contract_score(offer: JobOffer, config: ScoringConfig) -> float:
    if not offer.contract_type:
        return 0.0
    return config.preferred_contracts.get(offer.contract_type, 0.0)


def _location_score(offer: JobOffer, config: ScoringConfig) -> float:
    if not config.preferred_location or not offer.location:
        return 0.0
    if config.preferred_location.lower() in offer.location.lower():
        return config.location_bonus
    return 0.0


def _freshness_score(offer: JobOffer, config: ScoringConfig) -> float:
    if offer.posted_days_ago is None:
        return 0.0
    if offer.posted_days_ago <= config.freshness_max_days:
        return config.freshness_bonus
    return 0.0


def _rome_score(offer: JobOffer, config: ScoringConfig) -> float:
    if not offer.rome_code or not config.rome_codes:
        return 0.0
    return config.rome_codes.get(offer.rome_code, 0.0)


def _semantic_score(offer: JobOffer, config: ScoringConfig) -> float:
    if offer.semantic_score is None:
        return 0.0
    return offer.semantic_score * config.semantic_weight


def score_offer(offer: JobOffer, config: ScoringConfig) -> ScoredOffer:
    breakdown = {
        "keywords": _keyword_score(offer, config),
        "contract": _contract_score(offer, config),
        "rome": _rome_score(offer, config),
        "location": _location_score(offer, config),
        "freshness": _freshness_score(offer, config),
        "semantic": _semantic_score(offer, config),
    }
    return ScoredOffer(
        offer=offer,
        score=sum(breakdown.values()),
        score_breakdown=breakdown,
    )


def score_offers(offers: list[JobOffer], config: ScoringConfig) -> list[ScoredOffer]:
    scored = [score_offer(o, config) for o in offers]
    scored.sort(key=lambda s: s.score, reverse=True)
    return scored

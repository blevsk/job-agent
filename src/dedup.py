"""Dédup floue d'offres : repère les republiées presque-identiques.

France Travail (et d'autres sources) republient parfois la même offre avec un id différent
à quelques jours d'écart, parfois avec une variante de titre ("(H/F)" → "(F/H) (H/F)").
On regroupe par (titre normalisé, lieu normalisé) et on garde la plus récente.
"""

from __future__ import annotations

import re
import unicodedata

from .models import JobOffer

# Marqueurs de genre/intitulés à retirer du titre pour la normalisation.
_GENDER_PATTERNS = [
    re.compile(r"\(\s*h\s*/\s*f\s*\)", re.IGNORECASE),
    re.compile(r"\(\s*f\s*/\s*h\s*\)", re.IGNORECASE),
    re.compile(r"\bh\s*/\s*f\b", re.IGNORECASE),
    re.compile(r"\bf\s*/\s*h\b", re.IGNORECASE),
]
_NON_WORD = re.compile(r"[^\w\s]+", re.UNICODE)
_WHITESPACE = re.compile(r"\s+")
_DEPARTMENT_PREFIX = re.compile(r"^\s*\d{2,3}\s*-\s*", re.UNICODE)


def _strip_accents(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))


def _normalize_title(title: str) -> str:
    out = title
    for pat in _GENDER_PATTERNS:
        out = pat.sub(" ", out)
    out = _strip_accents(out).lower()
    out = _NON_WORD.sub(" ", out)
    out = _WHITESPACE.sub(" ", out).strip()
    return out


def _normalize_location(location: str | None) -> str:
    if not location:
        return ""
    out = _DEPARTMENT_PREFIX.sub("", location)
    out = _strip_accents(out).lower()
    out = _NON_WORD.sub(" ", out)
    out = _WHITESPACE.sub(" ", out).strip()
    return out


def _dedup_key(offer: JobOffer) -> tuple[str, str]:
    return _normalize_title(offer.title), _normalize_location(offer.location)


def _freshness_rank(offer: JobOffer) -> int:
    # Les offres sans date sont considérées plus anciennes (donc gardées en dernier recours).
    return offer.posted_days_ago if offer.posted_days_ago is not None else 10_000


def dedupe_offers(offers: list[JobOffer]) -> list[JobOffer]:
    """Regroupe par clé floue ; pour chaque groupe garde la plus récente.

    L'ordre relatif des offres est préservé (premier rencontré pour chaque clé,
    puis remplacement si une suivante est plus fraîche)."""
    by_key: dict[tuple[str, str], JobOffer] = {}
    order: list[tuple[str, str]] = []
    for offer in offers:
        key = _dedup_key(offer)
        existing = by_key.get(key)
        if existing is None:
            by_key[key] = offer
            order.append(key)
        elif _freshness_rank(offer) < _freshness_rank(existing):
            by_key[key] = offer
    return [by_key[k] for k in order]

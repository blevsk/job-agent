"""Client API France Travail (ex-Pôle Emploi) — Offres d'emploi v2.

Requiert deux variables d'environnement (à mettre dans `.env`) :
- FRANCE_TRAVAIL_CLIENT_ID
- FRANCE_TRAVAIL_CLIENT_SECRET

Inscription développeur : https://francetravail.io/data/api/offres-emploi
Souscrire au scope « api_offresdemploiv2 » + « o2dsoffre » et créer une application.
"""
from __future__ import annotations

import os
import re
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from .models import JobOffer

OAUTH_URL = (
    "https://entreprise.francetravail.fr/connexion/oauth2/access_token"
    "?realm=%2Fpartenaire"
)
SEARCH_URL = "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search"
INSEE_LOOKUP_URL = "https://api-adresse.data.gouv.fr/search/"
OAUTH_SCOPE = "api_offresdemploiv2 o2dsoffre"

# Mapping codes France Travail → libellé court utilisé par le scoring.
TYPE_CONTRAT_LABELS: dict[str, str] = {
    "CDI": "CDI",
    "CDD": "CDD",
    "MIS": "Intérim",
    "SAI": "Saisonnier",
    "FRA": "Franchise",
    "LIB": "Libéral",
    "REP": "Reprise d'entreprise",
    "TTI": "Travailleur indépendant",
    "CCE": "Contrat coopération étranger",
}

# Libellés de natureContrat correspondant à de l'alternance (FR renvoie le libellé, pas un code).
ALTERNANCE_NATURE_LABELS = {
    "contrat apprentissage",
    "contrat de professionnalisation",
    "contrat professionnalisation",
}


class FranceTravailError(RuntimeError):
    """Erreur côté API France Travail (auth, requête, parsing)."""


class MissingCredentialsError(FranceTravailError):
    pass


def _load_dotenv(path: Path) -> None:
    """Minuscule parseur .env pour éviter une dépendance supplémentaire."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def get_credentials(dotenv_path: Path | None = None) -> tuple[str, str]:
    if dotenv_path is not None:
        _load_dotenv(dotenv_path)
    else:
        _load_dotenv(Path.cwd() / ".env")
    client_id = os.environ.get("FRANCE_TRAVAIL_CLIENT_ID", "").strip()
    client_secret = os.environ.get("FRANCE_TRAVAIL_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        raise MissingCredentialsError(
            "FRANCE_TRAVAIL_CLIENT_ID / FRANCE_TRAVAIL_CLIENT_SECRET non définis. "
            "Inscris-toi sur https://francetravail.io et ajoute-les à ton .env."
        )
    return client_id, client_secret


def fetch_token(client: httpx.Client, client_id: str, client_secret: str) -> str:
    response = client.post(
        OAUTH_URL,
        data={
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": OAUTH_SCOPE,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    if response.status_code != 200:
        raise FranceTravailError(
            f"OAuth a échoué (HTTP {response.status_code}) : {response.text[:200]}"
        )
    payload = response.json()
    token = payload.get("access_token")
    if not token:
        raise FranceTravailError("OAuth : pas d'access_token dans la réponse.")
    return token


def resolve_insee_code(client: httpx.Client, location_label: str) -> str:
    """Convertit un libellé de commune en code INSEE via api-adresse.data.gouv.fr (sans auth)."""
    response = client.get(
        INSEE_LOOKUP_URL,
        params={"q": location_label, "type": "municipality", "limit": 1},
    )
    if response.status_code != 200:
        raise FranceTravailError(
            f"Résolution INSEE a échoué (HTTP {response.status_code}) pour « {location_label} »"
        )
    features = response.json().get("features") or []
    if not features:
        raise FranceTravailError(f"Aucune commune trouvée pour « {location_label} »")
    citycode = features[0]["properties"].get("citycode")
    if not citycode:
        raise FranceTravailError(f"Code INSEE manquant pour « {location_label} »")
    return citycode


def _normalize_contract(
    type_contrat: str | None,
    nature_contrat: str | None,
    alternance_flag: bool = False,
) -> str | None:
    if alternance_flag:
        return "Alternance"
    if nature_contrat and nature_contrat.strip().lower() in ALTERNANCE_NATURE_LABELS:
        return "Alternance"
    if type_contrat and type_contrat in TYPE_CONTRAT_LABELS:
        return TYPE_CONTRAT_LABELS[type_contrat]
    return type_contrat or None


def _days_since(iso_date: str | None) -> int | None:
    if not iso_date:
        return None
    try:
        dt = datetime.fromisoformat(iso_date.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    delta = datetime.now(timezone.utc) - dt
    return max(delta.days, 0)


def _clean_snippet(text: str | None, max_chars: int = 400) -> str | None:
    if not text:
        return None
    flat = re.sub(r"\s+", " ", text).strip()
    if len(flat) <= max_chars:
        return flat
    return flat[: max_chars - 1].rstrip() + "…"


def map_offer(raw: dict[str, Any]) -> JobOffer | None:
    offer_id = raw.get("id")
    title = raw.get("intitule")
    if not offer_id or not title:
        return None

    entreprise = raw.get("entreprise") or {}
    lieu = raw.get("lieuTravail") or {}
    salaire = raw.get("salaire") or {}
    origine = raw.get("origineOffre") or {}

    url = origine.get("urlOrigine") or (
        f"https://candidat.francetravail.fr/offres/recherche/detail/{offer_id}"
    )

    return JobOffer(
        id=str(offer_id),
        title=title,
        company=entreprise.get("nom") or None,
        location=lieu.get("libelle") or None,
        contract_type=_normalize_contract(
            raw.get("typeContrat"),
            raw.get("natureContrat"),
            alternance_flag=bool(raw.get("alternance")),
        ),
        salary=salaire.get("libelle") or None,
        posted_days_ago=_days_since(raw.get("dateCreation")),
        snippet=_clean_snippet(raw.get("description")),
        url=url,
        rome_code=raw.get("romeCode") or None,
    )


def parse_search_response(payload: dict[str, Any]) -> list[JobOffer]:
    results = payload.get("resultats") or []
    offers: list[JobOffer] = []
    for raw in results:
        try:
            mapped = map_offer(raw)
        except Exception:
            continue
        if mapped is not None:
            offers.append(mapped)
    return offers


def _fetch_page(
    client: httpx.Client,
    token: str,
    *,
    keyword: str,
    commune: str,
    distance: int,
    range_start: int,
    range_end: int,
    type_contrat: str | None,
    published_within_days: int | None,
) -> tuple[list[JobOffer], int]:
    params: dict[str, str] = {
        "motsCles": keyword,
        "commune": commune,
        "distance": str(distance),
        "range": f"{range_start}-{range_end}",
    }
    if type_contrat:
        params["typeContrat"] = type_contrat
    if published_within_days:
        params["publieeDepuis"] = str(published_within_days)

    response = client.get(
        SEARCH_URL,
        params=params,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )

    if response.status_code in (200, 206):
        # 206 = pagination partielle, attendu pour les ranges
        offers = parse_search_response(response.json())
        return offers, len(offers)
    if response.status_code == 204:
        return [], 0
    raise FranceTravailError(
        f"Recherche France Travail a échoué (HTTP {response.status_code}) : {response.text[:300]}"
    )


def search(
    keyword: str,
    location: str,
    radius_km: int = 25,
    *,
    max_results: int = 75,
    type_contrat: str | None = None,
    published_within_days: int | None = None,
    timeout: float = 20.0,
    on_page: Callable[[int, int, int], None] | None = None,
    dotenv_path: Path | None = None,
) -> list[JobOffer]:
    """Recherche des offres France Travail et retourne une liste dédupliquée de JobOffer."""
    client_id, client_secret = get_credentials(dotenv_path)
    page_size = 50  # max 150 d'après la doc ; 50 est un bon compromis débit/payload
    collected: dict[str, JobOffer] = {}

    with httpx.Client(timeout=timeout) as client:
        token = fetch_token(client, client_id, client_secret)
        commune_insee = resolve_insee_code(client, location)

        page_idx = 0
        while len(collected) < max_results:
            range_start = page_idx * page_size
            range_end = min(range_start + page_size - 1, max_results - 1)
            if range_end < range_start:
                break

            offers, found = _fetch_page(
                client,
                token,
                keyword=keyword,
                commune=commune_insee,
                distance=radius_km,
                range_start=range_start,
                range_end=range_end,
                type_contrat=type_contrat,
                published_within_days=published_within_days,
            )

            new_count = 0
            for offer in offers:
                if offer.id not in collected:
                    collected[offer.id] = offer
                    new_count += 1

            if on_page is not None:
                on_page(page_idx + 1, found, new_count)

            if found < (range_end - range_start + 1):
                break  # plus de résultats côté API

            page_idx += 1

    return list(collected.values())

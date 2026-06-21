"""Client API La Bonne Alternance — api.apprentissage.beta.gouv.fr

Requiert une variable d'environnement :
- API_APPRENTISSAGE_KEY  (crée ton compte sur https://api.apprentissage.beta.gouv.fr/fr/compte/profil)

Contrairement à France Travail, une seule requête accepte plusieurs codes ROME
et retourne toutes les offres d'alternance dans un rayon donné.
"""

from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from .env import load_dotenv
from .models import JobOffer

logger = logging.getLogger(__name__)

SEARCH_URL = "https://api.apprentissage.beta.gouv.fr/api/job/v1/search"
GEOCODE_URL = "https://api-adresse.data.gouv.fr/search/"

DIPLOMA_BAC = "4"  # niveau européen 4 = Bac


class LBAError(RuntimeError):
    pass


class MissingLBAKeyError(LBAError):
    pass


def get_api_key(dotenv_path: Path | None = None) -> str:
    load_dotenv(dotenv_path if dotenv_path is not None else Path.cwd() / ".env")
    key = os.environ.get("API_APPRENTISSAGE_KEY", "").strip()
    if not key:
        raise MissingLBAKeyError(
            "API_APPRENTISSAGE_KEY non définie. "
            "Inscris-toi sur https://api.apprentissage.beta.gouv.fr/fr/compte/profil "
            "et ajoute la clé à ton .env."
        )
    return key


def resolve_lat_lon(client: httpx.Client, location_label: str) -> tuple[float, float]:
    """Convertit un libellé de commune en (latitude, longitude) via api-adresse.data.gouv.fr."""
    r = client.get(GEOCODE_URL, params={"q": location_label, "type": "municipality", "limit": 1})
    if r.status_code != 200:
        raise LBAError(f"Géocodage échoué (HTTP {r.status_code}) pour « {location_label} »")
    features = r.json().get("features") or []
    if not features:
        raise LBAError(f"Aucune commune trouvée pour « {location_label} »")
    lon, lat = features[0]["geometry"]["coordinates"]
    return lat, lon


def _days_since(iso_date: str | None) -> int | None:
    if not iso_date:
        return None
    try:
        dt = datetime.fromisoformat(iso_date.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return max((datetime.now(timezone.utc) - dt).days, 0)


def _clean_snippet(text: str | None, max_chars: int = 400) -> str | None:
    if not text:
        return None
    flat = re.sub(r"\s+", " ", text).strip()
    return flat if len(flat) <= max_chars else flat[: max_chars - 1].rstrip() + "…"


def map_offer(raw: dict[str, Any]) -> JobOffer | None:
    identifier = raw.get("identifier", {})
    offer_data = raw.get("offer", {})
    workplace = raw.get("workplace", {})
    apply = raw.get("apply", {})
    contract = raw.get("contract", {})

    partner_id = identifier.get("partner_job_id")
    title = offer_data.get("title")
    if not partner_id or not title:
        return None

    if offer_data.get("status") in ("Filled", "Cancelled"):
        return None

    company = (
        workplace.get("brand") or workplace.get("name") or workplace.get("legal_name")
    ) or None
    location = (workplace.get("location") or {}).get("address") or None

    contract_types = contract.get("type") or []
    contract_type = "Alternance" if contract_types else None

    url = apply.get("url") or (
        f"https://labonnealternance.apprentissage.beta.gouv.fr/recherche-apprentissage"
        f"?type=matcha&itemId={partner_id}"
    )

    rome_codes = offer_data.get("rome_codes") or []
    publication = offer_data.get("publication") or {}

    return JobOffer(
        id=f"lba_{partner_id}",
        title=title,
        company=company,
        location=location,
        contract_type=contract_type,
        salary=None,
        posted_days_ago=_days_since(publication.get("creation")),
        snippet=_clean_snippet(offer_data.get("description")),
        url=url,
        rome_code=rome_codes[0] if rome_codes else None,
    )


def search(
    location: str,
    radius_km: int = 25,
    *,
    rome_codes: list[str] | None = None,
    diploma_level: str = DIPLOMA_BAC,
    max_results: int = 150,
    timeout: float = 20.0,
    dotenv_path: Path | None = None,
) -> list[JobOffer]:
    """Recherche des offres d'alternance via La Bonne Alternance.

    Une seule requête couvre tous les codes ROME passés, contrairement à France Travail
    qui nécessite une requête par code ROME.
    """
    api_key = get_api_key(dotenv_path)

    with httpx.Client(timeout=timeout) as client:
        lat, lon = resolve_lat_lon(client, location)

        params: dict[str, Any] = {
            "latitude": lat,
            "longitude": lon,
            "radius": min(radius_km, 200),
        }
        if diploma_level:
            params["target_diploma_level"] = diploma_level
        if rome_codes:
            params["romes"] = ",".join(rome_codes)

        r = client.get(
            SEARCH_URL,
            params=params,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Accept": "application/json",
            },
        )
        if r.status_code != 200:
            raise LBAError(f"Recherche LBA échouée (HTTP {r.status_code}) : {r.text[:300]}")

        offers: list[JobOffer] = []
        for raw in r.json().get("jobs") or []:
            try:
                mapped = map_offer(raw)
            except Exception:
                logger.warning("offre LBA ignorée (parsing échoué)", exc_info=True)
                continue
            if mapped is not None:
                offers.append(mapped)

        return offers[:max_results]

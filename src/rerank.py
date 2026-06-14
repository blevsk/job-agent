"""Re-rank LLM (Claude Haiku 4.5) du top-N d'offres.

Optionnel : si `ANTHROPIC_API_KEY` n'est pas définie, on skip silencieusement.
L'API Claude reçoit le profil + un JSON compact des offres et renvoie un
classement ordonné (rang 1 = meilleure offre) avec une justification courte.
"""
from __future__ import annotations

import json
import os
import textwrap
from typing import Any

from .models import JobOffer

MODEL = "claude-haiku-4-5-20251001"
SYSTEM_PROMPT = textwrap.dedent("""
    Tu es un assistant de recrutement personnel. Ton rôle est de comparer un profil
    candidat avec une liste d'offres d'emploi et de les classer par pertinence.

    Critères : alignement avec les compétences, le type de contrat souhaité, la
    localisation, les contraintes explicites du candidat, et la qualité de l'offre.

    Tu réponds UNIQUEMENT avec un JSON valide de la forme :
    {"ranking": [{"id": "<offer_id>", "rank": <int>, "reason": "<phrase courte FR>"}, ...]}

    - Inclus toutes les offres reçues dans le ranking, du meilleur (rank=1) au pire.
    - reason : 1 phrase de 10-25 mots, en français, qui explique le match (positif ou négatif).
    - Pas de markdown, pas de texte hors JSON.
""").strip()


def _offer_to_dict(offer: JobOffer) -> dict[str, Any]:
    return {
        "id": offer.id,
        "title": offer.title,
        "company": offer.company,
        "location": offer.location,
        "contract": offer.contract_type,
        "rome": offer.rome_code,
        "posted_days_ago": offer.posted_days_ago,
        "snippet": (offer.snippet or "")[:300],
    }


def _build_user_message(profile_text: str, offers: list[JobOffer]) -> str:
    payload = {"offers": [_offer_to_dict(o) for o in offers]}
    return (
        "## Profil candidat\n\n"
        f"{profile_text.strip()}\n\n"
        "## Offres à classer\n\n"
        f"```json\n{json.dumps(payload, ensure_ascii=False, indent=2)}\n```\n\n"
        "Renvoie le JSON de ranking demandé."
    )


def _extract_json(text: str) -> dict[str, Any]:
    """Récupère le JSON même si le LLM a glissé du texte autour (par sécurité,
    le system prompt l'interdit déjà)."""
    text = text.strip()
    if text.startswith("```"):
        # strip fences ```json ... ```
        text = text.split("```", 2)[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.rsplit("```", 1)[0]
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"Pas de JSON trouvé dans la réponse LLM : {text[:200]}")
    return json.loads(text[start : end + 1])


def llm_rerank(
    offers: list[JobOffer],
    profile_text: str,
    *,
    top_n: int = 20,
    model: str = MODEL,
    client: Any = None,
) -> list[JobOffer]:
    """Re-rank les `top_n` premières offres et écrit `llm_rank` + `llm_reason` dessus.

    Renvoie la liste complète d'offres (les non-rerankées ont `llm_rank=None`).
    Skip silencieusement si pas de clé API Anthropic configurée.
    """
    if not offers or not profile_text.strip():
        return offers

    if client is None:
        api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
        if not api_key:
            return offers
        from anthropic import Anthropic  # noqa: I001

        client = Anthropic(api_key=api_key)

    head = offers[:top_n]
    user_msg = _build_user_message(profile_text, head)

    response = client.messages.create(
        model=model,
        max_tokens=2000,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_msg}],
    )

    # L'API renvoie une liste de content blocks ; on récupère le texte concaténé.
    text = "".join(getattr(block, "text", "") for block in response.content)
    parsed = _extract_json(text)
    ranking = parsed.get("ranking") or []

    by_id = {o.id: o for o in head}
    for entry in ranking:
        offer = by_id.get(str(entry.get("id")))
        if offer is None:
            continue
        rank = entry.get("rank")
        if isinstance(rank, int):
            offer.llm_rank = rank
        reason = entry.get("reason")
        if isinstance(reason, str):
            offer.llm_reason = reason.strip()

    return offers

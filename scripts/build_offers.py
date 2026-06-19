"""Orchestrateur appelé par le workflow GitHub Action (et localement).

Pipeline :
  1. Fan-out sur N recherches (France Travail + La Bonne Alternance) via search.config.json
  2. Dédup floue
  3. Embeddings sémantiques (profile.md ↔ offres) — gratuit en local
  4. Scoring (mots-clés + contrat + ROME + lieu + fraîcheur + sémantique)
  5. Re-rank LLM Haiku 4.5 sur le top-N (skip si pas d'ANTHROPIC_API_KEY)
  6. Tri final + export → docs/offers.json
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src import france_travail, la_bonne_alternance  # noqa: E402
from src.dedup import dedupe_offers  # noqa: E402
from src.exporter import export_json  # noqa: E402
from src.la_bonne_alternance import MissingLBAKeyError  # noqa: E402
from src.models import JobOffer, ScoringConfig  # noqa: E402
from src.scoring import score_offers  # noqa: E402

RERANK_TOP_N = 20


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _load_search_config(path: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Retourne (searches, defaults). Supporte le format legacy (1 recherche au top-level)."""
    raw = _load_json(path)
    if "searches" in raw:
        return raw["searches"], raw.get("defaults", {})
    # Legacy : un seul {"keyword": ..., "location": ...}
    if "keyword" in raw:
        return [raw], {}
    raise ValueError(f"{path} : ni 'searches' ni 'keyword' trouvés.")


def _merge_with_defaults(search: dict[str, Any], defaults: dict[str, Any]) -> dict[str, Any]:
    return {**defaults, **search}


def _search_france_travail(idx: int, params: dict[str, Any]) -> list[JobOffer]:
    keyword   = params.get("keyword") or None
    rome_code = params.get("rome_code") or None
    location  = params.get("location")
    if not location or (not keyword and not rome_code):
        print(f"[skip] search #{idx} : location/keyword/rome_code manquants")
        return []
    return france_travail.search(
        location=location,
        keyword=keyword,
        rome_code=rome_code,
        radius_km=params.get("radius_km", 25),
        max_results=params.get("max_results", 150),
        type_contrat=params.get("contract_type"),
        published_within_days=params.get("published_within_days"),
        alternance_only=bool(params.get("alternance_only", False)),
        on_page=lambda p, f, n, _idx=idx: print(f"  [#{_idx}] page {p} → {f} offres ({n} nouvelles)"),
    )


def _search_lba(idx: int, params: dict[str, Any]) -> list[JobOffer]:
    location = params.get("location")
    if not location:
        print(f"[skip] search #{idx} LBA : location manquante")
        return []
    rome_codes = params.get("rome_codes") or None
    try:
        return la_bonne_alternance.search(
            location=location,
            radius_km=params.get("radius_km", 25),
            rome_codes=rome_codes,
            diploma_level=params.get("diploma_level", "4"),
            max_results=params.get("max_results", 150),
        )
    except MissingLBAKeyError:
        print(f"  [#{idx}] API_APPRENTISSAGE_KEY absente — skip LBA")
        return []


def fan_out_search(searches: list[dict[str, Any]], defaults: dict[str, Any]) -> list[JobOffer]:
    """Lance chaque recherche (France Travail ou La Bonne Alternance), agrège le tout."""
    all_offers: list[JobOffer] = []
    for idx, s in enumerate(searches, start=1):
        params = _merge_with_defaults(s, defaults)
        source = params.get("source", "france_travail")
        label  = params.get("_label") or params.get("rome_code") or params.get("keyword") or source

        print(f"[search #{idx}] {label} ({source}) — location='{params.get('location')}'")
        if source == "france_travail":
            offers = _search_france_travail(idx, params)
        elif source == "la_bonne_alternance":
            offers = _search_lba(idx, params)
        else:
            print(f"[skip] source inconnue : {source}")
            continue

        print(f"  [#{idx}] → {len(offers)} offres")
        all_offers.extend(offers)
    return all_offers


def main() -> int:
    search_cfg_path = ROOT / "search.config.json"
    if not search_cfg_path.exists():
        print(f"[error] {search_cfg_path} introuvable.", file=sys.stderr)
        return 2

    scoring_cfg_path = ROOT / "scoring.config.json"
    if not scoring_cfg_path.exists():
        scoring_cfg_path = ROOT / "scoring.example.json"

    profile_path = ROOT / "profile.md"
    profile_text = profile_path.read_text(encoding="utf-8") if profile_path.exists() else ""

    searches, defaults = _load_search_config(search_cfg_path)
    scoring_cfg = ScoringConfig.model_validate(_load_json(scoring_cfg_path))
    print(f"[config] {len(searches)} recherche(s), scoring via {scoring_cfg_path.name}")
    if profile_text.strip():
        print(f"[profile] {len(profile_text)} caractères chargés depuis {profile_path.name}")
    else:
        print("[profile] aucun profil — semantic et re-rank désactivés")

    # 1 + 2 : fan-out + dédup
    raw_offers = fan_out_search(searches, defaults)
    print(f"[fetched] {len(raw_offers)} offres brutes (toutes recherches confondues)")
    deduped = dedupe_offers(raw_offers)
    if len(deduped) < len(raw_offers):
        print(f"[dedup] -{len(raw_offers) - len(deduped)} doublons → {len(deduped)} uniques")

    # 3 : embeddings sémantiques (skip si pas de profil)
    if profile_text.strip() and deduped:
        try:
            from src.semantic import enrich_with_semantic  # noqa: I001

            print(f"[semantic] embeddings sur {len(deduped)} offres…")
            enrich_with_semantic(deduped, profile_text)
            n_scored = sum(1 for o in deduped if o.semantic_score is not None)
            print(f"[semantic] {n_scored} offres enrichies")
        except ImportError as exc:
            print(f"[semantic] sentence-transformers non installé ({exc}) — skip")
        except Exception as exc:  # noqa: BLE001
            print(f"[semantic] erreur : {exc} — skip")

    # 4 : scoring (inclut la composante semantic via semantic_weight)
    scored = score_offers(deduped, scoring_cfg)

    # 5 : re-rank LLM sur le top-N (skip si pas de clé)
    top_offers = [s.offer for s in scored[:RERANK_TOP_N]]
    if profile_text.strip() and top_offers and os.environ.get("ANTHROPIC_API_KEY", "").strip():
        try:
            from src.rerank import llm_rerank  # noqa: I001

            print(f"[rerank] LLM Haiku sur top-{len(top_offers)}…")
            llm_rerank(top_offers, profile_text, top_n=RERANK_TOP_N)
            n_ranked = sum(1 for o in top_offers if o.llm_rank is not None)
            print(f"[rerank] {n_ranked} offres rangées par le LLM")
            # Re-trier : les offres avec llm_rank passent en tête, puis tri par score
            scored.sort(
                key=lambda s: (
                    0 if s.offer.llm_rank is not None else 1,
                    s.offer.llm_rank if s.offer.llm_rank is not None else 0,
                    -s.score,
                )
            )
        except ImportError as exc:
            print(f"[rerank] anthropic non installé ({exc}) — skip")
        except Exception as exc:  # noqa: BLE001
            print(f"[rerank] erreur : {exc} — skip")
    else:
        if not os.environ.get("ANTHROPIC_API_KEY", "").strip():
            print("[rerank] ANTHROPIC_API_KEY absent — skip")

    # 6 : export
    meta = {
        "source": "france_travail",
        "searches": [
            {
                "label": _merge_with_defaults(s, defaults).get("_label") or s.get("rome_code") or s.get("keyword"),
                "rome_code": s.get("rome_code"),
                "keyword": s.get("keyword"),
                "location": _merge_with_defaults(s, defaults).get("location"),
            }
            for s in searches
        ],
        "scraped_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "rerank_active": any(s.offer.llm_rank is not None for s in scored),
        "semantic_active": any(s.offer.semantic_score is not None for s in scored),
    }
    output = ROOT / "docs" / "offers.json"
    export_json(scored, output, meta)
    print(f"[ok] {len(scored)} offres scorées → {output.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

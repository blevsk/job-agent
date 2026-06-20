"""Orchestrateur appelé par le workflow GitHub Action (et localement).

Pipeline :
  1. Fan-out sur N recherches (France Travail + La Bonne Alternance) via search.config.json
  2. Dédup floue
  3. Embeddings sémantiques (profile.md ↔ offres) — gratuit en local
  4. Scoring (mots-clés + contrat + ROME + lieu + fraîcheur + sémantique)
  5. Re-rank LLM Haiku 4.5 sur le top-N (skip si pas d'ANTHROPIC_API_KEY)
  6. Tri final + export → docs/{profile}/offers.json

Usage :
  python scripts/build_offers.py                    # profil par défaut (dossier profiles/ unique)
  python scripts/build_offers.py --profile yohan    # profil explicite
"""
from __future__ import annotations

import argparse
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


def _resolve_profile(name: str | None) -> tuple[str, Path]:
    """Retourne (profile_name, profile_dir). Auto-détecte si name est None."""
    profiles_root = ROOT / "profiles"

    # Compatibilité legacy : pas de dossier profiles/ → on utilise les fichiers à la racine
    if not profiles_root.exists():
        return "default", ROOT

    if name:
        d = profiles_root / name
        if not d.is_dir():
            print(f"[error] Profil '{name}' introuvable dans {profiles_root}", file=sys.stderr)
            sys.exit(2)
        return name, d

    # Auto-détection : liste des sous-dossiers
    dirs = sorted(d for d in profiles_root.iterdir() if d.is_dir())
    if not dirs:
        print(f"[error] Aucun profil trouvé dans {profiles_root}", file=sys.stderr)
        sys.exit(2)
    return dirs[0].name, dirs[0]


def _generate_profiles_manifest() -> None:
    """Génère docs/profiles.json à partir de profiles/*/meta.json."""
    profiles_root = ROOT / "profiles"
    if not profiles_root.exists():
        return
    entries = []
    for d in sorted(p for p in profiles_root.iterdir() if p.is_dir()):
        meta_path = d / "meta.json"
        meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
        entries.append({"id": d.name, "label": meta.get("label", d.name.capitalize())})
    manifest = {"profiles": entries, "default": entries[0]["id"] if entries else None}
    out = ROOT / "docs" / "profiles.json"
    out.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[manifest] {len(entries)} profil(s) → {out.relative_to(ROOT)}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", default=None, help="Nom du profil (dossier dans profiles/)")
    parser.add_argument("--all", dest="all_profiles", action="store_true",
                        help="Build tous les profils + génère le manifeste")
    args = parser.parse_args()

    if args.all_profiles:
        profiles_root = ROOT / "profiles"
        if not profiles_root.exists():
            print("[error] Dossier profiles/ introuvable", file=sys.stderr)
            return 2
        dirs = sorted(d for d in profiles_root.iterdir() if d.is_dir())
        if not dirs:
            print("[error] Aucun profil dans profiles/", file=sys.stderr)
            return 2
        exit_code = 0
        for d in dirs:
            print(f"\n{'='*50}\n[profile] {d.name}\n{'='*50}")
            code = _build_profile(d.name, d)
            if code != 0:
                exit_code = code
        _generate_profiles_manifest()
        return exit_code

    profile_name, profile_dir = _resolve_profile(args.profile)
    code = _build_profile(profile_name, profile_dir)
    _generate_profiles_manifest()
    return code


def _build_profile(profile_name: str, profile_dir: Path) -> int:
    print(f"[profile] {profile_name} ({profile_dir.relative_to(ROOT)})")

    # Chemins spécifiques au profil
    if profile_dir == ROOT:
        # Mode legacy : fichiers à la racine
        search_cfg_path  = ROOT / "search.config.json"
        scoring_cfg_path = ROOT / "scoring.config.json"
        profile_path     = ROOT / "profile.md"
        output           = ROOT / "docs" / "offers.json"
    else:
        search_cfg_path  = profile_dir / "search.config.json"
        scoring_cfg_path = profile_dir / "scoring.config.json"
        if not scoring_cfg_path.exists():
            scoring_cfg_path = ROOT / "scoring.example.json"
        profile_path = profile_dir / "profile.md"
        output       = ROOT / "docs" / profile_name / "offers.json"
        output.parent.mkdir(parents=True, exist_ok=True)

    if not search_cfg_path.exists():
        print(f"[error] {search_cfg_path} introuvable.", file=sys.stderr)
        return 2

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

    # 5 : re-rank LLM sur toutes les offres à score positif (skip si pas de clé)
    top_offers = [s.offer for s in scored if s.score > 0]
    if profile_text.strip() and top_offers and os.environ.get("ANTHROPIC_API_KEY", "").strip():
        try:
            from src.rerank import llm_rerank  # noqa: I001

            print(f"[rerank] LLM Haiku sur {len(top_offers)} offres à score positif…")
            llm_rerank(top_offers, profile_text, top_n=len(top_offers))
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

    # 6 : supprimer les offres à score négatif puis export
    scored = [s for s in scored if s.score >= 0]
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
    export_json(scored, output, meta)
    print(f"[ok] {len(scored)} offres scorées → {output.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

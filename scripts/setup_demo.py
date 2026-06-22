"""Crée un profil démo local pour tester le frontend sans appels API.

Usage :
  python scripts/setup_demo.py          # crée docs/demo/ + met à jour profiles.json
  python scripts/setup_demo.py --clean  # supprime docs/demo/ + met à jour profiles.json
"""

from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEMO_ID = "demo"
DEMO_OUT = ROOT / "docs" / DEMO_ID
PROFILES_JSON = ROOT / "docs" / "profiles.json"

DEMO_OFFERS = {
    "meta": {
        "source": "demo",
        "searches": [{"label": "Démo locale", "keyword": "développeur", "location": "Lille"}],
        "scraped_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "rerank_active": True,
        "semantic_active": True,
        "total": 5,
    },
    "offers": [
        {
            "id": "demo_001",
            "title": "Développeur Python / Django",
            "company": "Acme Corp",
            "location": "Lille (59)",
            "contract_type": "Alternance",
            "salary": "1 800 € brut/mois",
            "posted_days_ago": 2,
            "snippet": "Rejoignez notre équipe pour développer des APIs REST en Python et Django. Vous travaillerez sur une plateforme SaaS B2B en pleine croissance.",
            "url": "https://example.com/offre/001",
            "rome_code": "M1805",
            "semantic_score": 0.87,
            "llm_rank": 1,
            "llm_reason": "Correspond parfaitement au profil : Python, Django, alternance à Lille.",
            "score": 28.7,
            "score_breakdown": {
                "keywords": 15.0,
                "contract": 5.0,
                "rome": 4.0,
                "location": 3.0,
                "freshness": 2.0,
                "semantic": -0.3,
            },
        },
        {
            "id": "demo_002",
            "title": "Alternant Développeur Web React/Node",
            "company": "StartupXYZ",
            "location": "Roubaix (59)",
            "contract_type": "Alternance",
            "salary": None,
            "posted_days_ago": 5,
            "snippet": "Mission : développement de nouvelles fonctionnalités sur notre application web. Stack : React, Node.js, PostgreSQL.",
            "url": "https://example.com/offre/002",
            "rome_code": "M1805",
            "semantic_score": 0.72,
            "llm_rank": 2,
            "llm_reason": "Bon match sur l'alternance et le lieu, mais stack JS plutôt que Python.",
            "score": 22.4,
            "score_breakdown": {
                "keywords": 8.0,
                "contract": 5.0,
                "rome": 4.0,
                "location": 0.0,
                "freshness": 2.0,
                "semantic": 3.4,
            },
        },
        {
            "id": "demo_003",
            "title": "Data Scientist Junior",
            "company": "DataLab France",
            "location": "Lille (59)",
            "contract_type": "CDI",
            "salary": "35 000 € brut/an",
            "posted_days_ago": 10,
            "snippet": "Analyse de données, machine learning, Python/scikit-learn. Profil junior accepté avec stage ou alternance significatif.",
            "url": "https://example.com/offre/003",
            "rome_code": "M1403",
            "semantic_score": 0.61,
            "llm_rank": 3,
            "llm_reason": "Profil data science intéressant mais contrat CDI, pas alternance.",
            "score": 18.1,
            "score_breakdown": {
                "keywords": 10.0,
                "contract": 0.0,
                "rome": 0.0,
                "location": 3.0,
                "freshness": 0.0,
                "semantic": 5.1,
            },
        },
        {
            "id": "demo_004",
            "title": "Technicien Support Informatique",
            "company": "Groupe Renard",
            "location": "Lens (62)",
            "contract_type": "CDD",
            "salary": "1 600 € brut/mois",
            "posted_days_ago": 20,
            "snippet": "Support utilisateurs niveau 1 et 2, gestion du parc informatique, helpdesk.",
            "url": "https://example.com/offre/004",
            "rome_code": "M1607",
            "semantic_score": 0.38,
            "llm_rank": None,
            "llm_reason": None,
            "score": 8.0,
            "score_breakdown": {
                "keywords": 2.0,
                "contract": 0.0,
                "rome": 0.0,
                "location": 0.0,
                "freshness": 0.0,
                "semantic": 6.0,
            },
        },
        {
            "id": "demo_005",
            "title": "Chargé de projet digital",
            "company": "Agence Web Nord",
            "location": "Villeneuve-d'Ascq (59)",
            "contract_type": "Alternance",
            "salary": None,
            "posted_days_ago": 3,
            "snippet": "Pilotage de projets de transformation digitale, coordination équipes techniques et clients.",
            "url": "https://example.com/offre/005",
            "rome_code": None,
            "semantic_score": 0.44,
            "llm_rank": None,
            "llm_reason": None,
            "score": 12.5,
            "score_breakdown": {
                "keywords": 0.0,
                "contract": 5.0,
                "rome": 0.0,
                "location": 3.0,
                "freshness": 2.0,
                "semantic": 2.5,
            },
        },
    ],
}


def _read_profiles() -> dict:
    if PROFILES_JSON.exists():
        return json.loads(PROFILES_JSON.read_text(encoding="utf-8"))
    return {"profiles": [], "default": None}


def _write_profiles(data: dict) -> None:
    PROFILES_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def create() -> None:
    DEMO_OUT.mkdir(parents=True, exist_ok=True)
    offers_path = DEMO_OUT / "offers.json"
    offers_path.write_text(json.dumps(DEMO_OFFERS, ensure_ascii=False, indent=2), encoding="utf-8")

    manifest = _read_profiles()
    if not any(p["id"] == DEMO_ID for p in manifest["profiles"]):
        manifest["profiles"].insert(0, {"id": DEMO_ID, "label": "Démo"})
    if not manifest.get("default"):
        manifest["default"] = DEMO_ID
    _write_profiles(manifest)

    print(f"[ok] démo créée → {offers_path.relative_to(ROOT)}")
    print(f"[ok] profiles.json mis à jour ({len(manifest['profiles'])} profil(s))")
    print("[  ] ouvre docs/index.html directement dans le navigateur (ou déploie sur staging)")


def clean() -> None:
    if DEMO_OUT.exists():
        shutil.rmtree(DEMO_OUT)
        print(f"[ok] {DEMO_OUT.relative_to(ROOT)} supprimé")

    manifest = _read_profiles()
    manifest["profiles"] = [p for p in manifest["profiles"] if p["id"] != DEMO_ID]
    if manifest.get("default") == DEMO_ID:
        manifest["default"] = manifest["profiles"][0]["id"] if manifest["profiles"] else None
    _write_profiles(manifest)
    print("[ok] profiles.json mis à jour")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--clean", action="store_true", help="Supprime le profil démo")
    args = parser.parse_args()
    clean() if args.clean else create()

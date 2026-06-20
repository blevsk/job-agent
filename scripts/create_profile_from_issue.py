"""Lit le JSON d'une issue GitHub et crée les fichiers du profil dans profiles/{id}/."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    body = sys.stdin.read().strip()
    try:
        data = json.loads(body)
    except json.JSONDecodeError as e:
        print(f"[error] Corps de l'issue invalide (JSON attendu) : {e}", file=sys.stderr)
        return 1

    pid = data.get("profileId", "").strip()
    if not pid or len(pid) > 32 or not pid.isalnum():
        print(f"[error] profileId invalide : {pid!r}", file=sys.stderr)
        return 1

    required = {"profileId", "profileMd", "searchConfig", "scoringConfig", "poste"}
    missing = required - data.keys()
    if missing:
        print(f"[error] Champs manquants dans l'issue : {missing}", file=sys.stderr)
        return 1

    profile_dir = ROOT / "profiles" / pid
    profile_dir.mkdir(parents=True, exist_ok=True)

    (profile_dir / "meta.json").write_text(
        json.dumps({"label": data["poste"]}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (profile_dir / "profile.md").write_text(data["profileMd"], encoding="utf-8")
    (profile_dir / "search.config.json").write_text(
        json.dumps(data["searchConfig"], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (profile_dir / "scoring.config.json").write_text(
        json.dumps(data["scoringConfig"], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    # Sauvegarde pour les étapes suivantes du workflow
    Path("/tmp/job_agent_profile.json").write_text(
        json.dumps({"profileId": pid}), encoding="utf-8"
    )

    print(f"[ok] Profil {pid!r} créé dans {profile_dir.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

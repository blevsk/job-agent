"""Lit le JSON d'une issue GitHub et crée/met à jour les fichiers du profil dans profiles/{id}/.

Utilisé par build-profile.yml pour les créations ET les rebuilds.
Tous les champs sauf profileId sont optionnels — seuls les champs présents sont écrits.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _strip_code_fence(body: str) -> str:
    """Retire les balises markdown ```json ... ``` si l'utilisateur les a ajoutées."""
    if not body.startswith("```"):
        return body
    lines = body.splitlines()
    start = 1
    end = next(
        (i for i in range(len(lines) - 1, 0, -1) if lines[i].strip() == "```"),
        len(lines),
    )
    return "\n".join(lines[start:end]).strip()


def main() -> int:
    body = _strip_code_fence(sys.stdin.read().strip())
    try:
        data = json.loads(body)
    except json.JSONDecodeError as e:
        print(f"[error] JSON invalide : {e}", file=sys.stderr)
        return 1

    pid = data.get("profileId", "").strip()
    if not pid or len(pid) > 32 or not pid.isalnum():
        print(f"[error] profileId invalide : {pid!r}", file=sys.stderr)
        return 1

    profile_dir = ROOT / "profiles" / pid
    profile_dir.mkdir(parents=True, exist_ok=True)

    if "poste" in data:
        meta_path = profile_dir / "meta.json"
        meta = (
            json.loads(meta_path.read_text(encoding="utf-8"))
            if meta_path.exists()
            else {}
        )
        meta["label"] = data["poste"]
        meta_path.write_text(
            json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    if "profileMd" in data:
        (profile_dir / "profile.md").write_text(data["profileMd"], encoding="utf-8")

    if "searchConfig" in data:
        (profile_dir / "search.config.json").write_text(
            json.dumps(data["searchConfig"], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    if "scoringConfig" in data:
        (profile_dir / "scoring.config.json").write_text(
            json.dumps(data["scoringConfig"], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    Path("/tmp/job_agent_profile.json").write_text(
        json.dumps({"profileId": pid}), encoding="utf-8"
    )
    print(f"[ok] Profil {pid!r} appliqué dans {profile_dir.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

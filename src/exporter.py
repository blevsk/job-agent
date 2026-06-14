from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .models import ScoredOffer


def serialize(scored: list[ScoredOffer], meta: dict[str, Any]) -> dict[str, Any]:
    return {
        "meta": {**meta, "total": len(scored)},
        "offers": [
            {
                **s.offer.model_dump(),
                "score": s.score,
                "score_breakdown": s.score_breakdown,
            }
            for s in scored
        ],
    }


def export_json(scored: list[ScoredOffer], path: Path, meta: dict[str, Any]) -> None:
    payload = serialize(scored, meta)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)

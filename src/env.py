"""Chargement minimal des variables d'environnement depuis un fichier .env.

Pas de dépendance externe — python-dotenv n'est pas requis.
"""

import os
from pathlib import Path


def load_dotenv(path: Path) -> None:
    """Charge les variables d'un fichier .env dans os.environ (sans écraser les valeurs existantes)."""
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

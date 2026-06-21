from __future__ import annotations

import logging
import os


def setup_logging() -> logging.Logger:
    """Configure le logger racine et retourne le logger principal du projet.

    Niveau par défaut : INFO. Surcharger via LOG_LEVEL=DEBUG pour voir la pagination
    et les détails internes sans modifier le code.
    """
    level_name = os.environ.get("LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)-8s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    return logging.getLogger("job_agent")

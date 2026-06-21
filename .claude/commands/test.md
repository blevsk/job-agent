Lance la suite de tests et affiche le résultat.

- Exécute `python -m pytest -q --tb=short`.
- Si des tests échouent, montre les tracebacks complets et explique la cause probable.
- Si tous passent, affiche le nombre de tests et la durée.
- Si l'argument `coverage` est précisé, utilise `make coverage` pour afficher aussi la couverture par module.

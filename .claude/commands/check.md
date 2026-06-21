Validation complète avant un commit : lint, types, tests.

Exécute dans l'ordre :
1. `ruff check src/ scripts/ tests/` — lint
2. `black --check src/ scripts/ tests/` — formatage
3. `pyright` — vérification des types
4. `python -m pytest -q --tb=short` — tests

Arrête-toi à la première étape qui échoue et explique ce qui ne va pas. Si tout passe, confirme que le code est prêt à commiter.

Corrige automatiquement les erreurs de style dans tout le projet.

Étapes :
1. Exécute `ruff check --fix src/ scripts/ tests/` pour corriger les imports et violations auto-fixables.
2. Exécute `black src/ scripts/ tests/` pour reformater le code.
3. Exécute `ruff check src/ scripts/ tests/` une dernière fois pour vérifier qu'il ne reste pas d'erreurs non auto-fixables.
4. Si des erreurs persistent après fix, liste-les — elles demandent une correction manuelle.
5. Résume en une phrase ce qui a été corrigé (nombre de fichiers, types d'erreurs).

Utilisation typique : après un échec de pre-commit sur ruff ou black, lancer `/fix` plutôt que de corriger à la main.

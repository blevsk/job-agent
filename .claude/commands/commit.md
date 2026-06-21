Prépare et crée un commit en suivant les conventions du projet.

Étapes :
1. Exécute `git status` et `git diff` (staged + unstaged) pour voir ce qui a changé.
2. Stage les fichiers pertinents (jamais `.env`, `*.pyc`, fichiers temporaires ni secrets).
3. Rédige un message de commit en français, format : `type: description courte`
   - Types : `feat` (nouvelle fonctionnalité), `fix` (correction), `refactor`, `test`, `docs`, `chore`, `style`
   - 1 ligne max, impératif présent, en minuscules sauf noms propres
   - Pas de `Co-Authored-By`
4. Crée le commit, puis pousse (`git push`) — l'accord de commit implique l'accord de push.
5. Signale ce qui a été commité en une phrase.

Si des tests échouent (hook pre-commit), corrige d'abord avant de recommiter.

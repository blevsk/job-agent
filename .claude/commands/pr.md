Crée une Pull Request GitHub pour la branche courante via le MCP GitHub.

Étapes :
1. Exécute `git status` et `git log main..HEAD --oneline` pour voir les commits depuis main.
2. Exécute `git diff main..HEAD --stat` pour avoir un aperçu des fichiers modifiés.
3. Déduis un titre court (< 70 caractères) depuis les commits — en français, style `type: description`.
4. Rédige la description au format suivant :

   ## Résumé
   - [bullet 1]
   - [bullet 2]

   ## Plan de test
   - [ ] Todo 1
   - [ ] Todo 2

5. Crée la PR avec `mcp__github__create_pull_request` :
   - `owner` : Blevsk
   - `repo` : job-agent
   - `head` : branche courante
   - `base` : main
   - `title` : titre déduit
   - `body` : description structurée ci-dessus
6. Retourne l'URL de la PR créée.

Si la branche courante est déjà main, signale-le et ne crée pas de PR.
Si des fichiers ne sont pas commités, propose d'abord de faire un `/commit`.

Lance le pipeline de build des offres d'emploi.

- S'il y a un seul profil dans `profiles/`, utilise `python scripts/build_offers.py`.
- S'il y a plusieurs profils ou si l'argument `--all` est précisé, utilise `python scripts/build_offers.py --all`.
- Affiche un résumé : nombre d'offres récupérées, scorées, re-rankées, et exportées.
- En cas d'erreur, affiche le message d'erreur complet et propose une piste de correction.

---
name: Nouveau profil
about: "Créer un nouveau profil de recherche. Compléter les valeurs JSON ci-dessous (ne pas modifier les clés). profileId : alphanumérique, max 32 caractères."
title: '[job-agent] '
---
{
  "profileId": "monprofil",
  "poste": "Mon Titre de Poste",
  "profileMd": "Description du candidat : compétences, expérience, préférences de poste et de lieu...",
  "searchConfig": {
    "defaults": {
      "location": "Ville",
      "radius_km": 25,
      "max_results": 150
    },
    "searches": [
      { "keyword": "mot-clé principal", "_label": "Label affiché dans les logs" }
    ]
  },
  "scoringConfig": {
    "keywords": [
      { "pattern": "compétence", "weight": 5.0 },
      { "pattern": "compétence indésirable", "weight": -3.0 }
    ],
    "preferred_contracts": { "CDI": 5.0, "Alternance": 3.0 },
    "rome_codes": {},
    "preferred_location": "Ville",
    "location_bonus": 3.0,
    "freshness_bonus": 2.0,
    "freshness_max_days": 7,
    "semantic_weight": 10.0
  }
}

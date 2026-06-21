# Job Agent

Automatically fetches, scores, and ranks job offers from France Travail and La Bonne Alternance for one or more candidate profiles. Results are published to a web app on GitHub Pages.

## How it works

1. You define a candidate profile (job criteria, search queries, scoring weights).
2. A GitHub Actions workflow fetches matching offers, scores them, and re-ranks the top results using an LLM.
3. The results are published to a static web app where you can browse, filter, track applications, and add notes.

Offers are automatically refreshed every day at 06:00 UTC.

---

## Prerequisites

Before creating a profile you need:

- A **France Travail API account**: register at [francetravail.io](https://francetravail.io), create an application, and subscribe to the `api_offresdemploiv2` + `o2dsoffre` scopes. You will get a `CLIENT_ID` and `CLIENT_SECRET`.
- *(Optional)* A **La Bonne Alternance API key**: register at [api.apprentissage.beta.gouv.fr](https://api.apprentissage.beta.gouv.fr/fr/compte/profil).
- *(Optional)* An **Anthropic API key** for LLM re-ranking.

Add these as GitHub Actions secrets in your repo: **Settings → Secrets and variables → Actions**.

| Secret | Purpose |
|---|---|
| `FRANCE_TRAVAIL_CLIENT_ID` | France Travail OAuth client ID |
| `FRANCE_TRAVAIL_CLIENT_SECRET` | France Travail OAuth client secret |
| `ANTHROPIC_API_KEY` | LLM re-rank (optional) |
| `API_APPRENTISSAGE_KEY` | La Bonne Alternance (optional) |

---

## Creating a profile

Open a GitHub issue in this repository. The **issue title** must start with `[job-agent] ` and the **issue body** must be a valid JSON object.

**Minimum required:**
```json
{
  "profileId": "myprofile",
  "poste": "Développeur Python",
  "searchConfig": {
    "defaults": { "location": "Lille", "radius_km": 25, "max_results": 150 },
    "searches": [
      { "keyword": "développeur python", "_label": "Dev Python" }
    ]
  }
}
```

**All available fields:**

| Field | Required | Description |
|---|---|---|
| `profileId` | Yes | Alphanumeric identifier, max 32 characters. Used as folder name and URL slug. |
| `poste` | No | Job title shown in the web app header. |
| `profileMd` | No | Free-text description of the candidate (skills, experience, preferences). Used for semantic matching and LLM re-ranking. The more detail, the better the results. |
| `searchConfig` | No | Search queries (see below). |
| `scoringConfig` | No | Scoring weights (see below). |

Once the issue is created, the workflow runs automatically, builds the results, and closes the issue with a success or failure comment.

---

## Updating a profile

To update an existing profile, open a new issue with the title starting with `[job-agent-rebuild] ` and the same JSON body. Only the fields present in the JSON will be updated — absent fields are left unchanged.

---

## Configuring searches (`searchConfig`)

```json
{
  "defaults": {
    "location": "Lille",
    "radius_km": 25,
    "max_results": 150,
    "contract_type": "CDI",
    "published_within_days": 31
  },
  "searches": [
    { "keyword": "développeur python", "_label": "Dev Python", "source": "france_travail" },
    { "keyword": "data engineer", "_label": "Data" },
    { "rome_codes": ["M1805"], "source": "la_bonne_alternance", "diploma_level": "4" }
  ]
}
```

- `defaults` apply to all searches unless overridden per entry.
- `source`: `"france_travail"` (default) or `"la_bonne_alternance"`.
- `contract_type`: `CDI`, `CDD`, `MIS` (interim), `SAI` (seasonal).
- `published_within_days`: `1`, `3`, `7`, `14`, or `31`.
- `alternance_only`: `true` to filter alternance contracts only (France Travail).
- France Travail returns at most **150 results per search**. Use multiple searches to increase coverage.

---

## Configuring scoring (`scoringConfig`)

The score of each offer is the sum of all active components. Offers with a negative total score are excluded.

```json
{
  "keywords": [
    { "pattern": "python", "weight": 5.0 },
    { "pattern": "django|fastapi", "weight": 3.0 },
    { "pattern": "excel", "weight": -2.0 }
  ],
  "preferred_contracts": { "CDI": 5.0, "Alternance": 3.0 },
  "rome_codes": { "M1805": 4.0 },
  "preferred_location": "Lille",
  "location_bonus": 3.0,
  "freshness_bonus": 2.0,
  "freshness_max_days": 7,
  "semantic_weight": 10.0
}
```

| Field | Description |
|---|---|
| `keywords[].pattern` | Python regex (case-insensitive) matched against offer title + description. Negative weights penalise unwanted offers. |
| `preferred_contracts` | Bonus per contract type. |
| `rome_codes` | Bonus per ROME code. |
| `preferred_location` | Substring match against offer location. |
| `location_bonus` | Points added when `preferred_location` matches. |
| `freshness_bonus` | Points added for offers published within `freshness_max_days`. |
| `semantic_weight` | Scales the semantic similarity score (0–1). A value of 10 means a perfect match adds 10 points. Requires `profileMd`. |

---

## Using the web app

The app is accessible at your GitHub Pages URL (e.g. `https://<username>.github.io/<repo>/`).

If you have multiple profiles, use the profile switcher in the top-right corner.

### Views

- **Table view**: sortable columns. Click any column header to sort.
- **Kanban view**: drag offers between status columns.

### Columns

| Column | Description |
|---|---|
| LLM Rank | Rank assigned by the LLM (1 = best match). Only shown when `ANTHROPIC_API_KEY` is set. |
| Score | Numeric score from keyword + contract + ROME + location + freshness + semantic components. |
| ROME / Sém. | ROME code and semantic similarity percentage. |

### Filtering and searching

- Use the search bar to filter by any text (title, company, location).
- Use the **Status** dropdown to filter by application status.
- Check **Masquer lues** to hide offers you have already read.

### Tracking applications

Click the **Statut** cell of any offer to set its status:
- `Postulée` — you have applied.
- `Entretien` — interview scheduled.
- `Relancée` — you followed up.
- `Refusée` — rejected.

Click the offer row to open the notes panel and add free-text notes (contact name, phone number, impressions, etc.).

All tracking data is saved automatically and persists between sessions.

### Adding an offer manually

Click **+ Ajouter** to add an offer not found by the automated search (e.g. from LinkedIn or a company website). Fill in the title and URL at minimum.

### Exporting

Click **Export CSV** to download all visible offers as a spreadsheet.

---

## Deleting a profile

Run locally:
```bash
./scripts/delete_profile.sh <profileId>
```

This removes `profiles/<profileId>/`, `docs/<profileId>/`, and updates `docs/profiles.json`. Commit and push the result.

---

## Troubleshooting

**The workflow failed — what do I do?**
Open the failed issue, click the workflow link in the error comment, and read the logs. Each pipeline step is labelled (`[search]`, `[semantic]`, `[rerank]`, etc.). Set `LOG_LEVEL=DEBUG` in the workflow env to see pagination details.

**Offers are not being found.**
Check that your `searchConfig` keywords match real France Travail job titles. Try the [France Travail job search](https://candidat.francetravail.fr/offres/recherche) to validate your keywords before adding them to the config.

**The LLM re-rank is not running.**
`ANTHROPIC_API_KEY` is missing or empty in your GitHub Actions secrets. The pipeline skips re-ranking silently when the key is absent — this is expected behaviour.

**The semantic score column is empty.**
`profileMd` is absent or empty in your profile config. Add a description of the candidate to enable semantic matching.

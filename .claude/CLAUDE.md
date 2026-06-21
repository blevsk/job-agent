# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development principles

- **Sobriety**: do not code for the sake of coding. Every line and dependency must have a reason. Favour performance and minimal resource usage.
- **Structured simplicity**: the simplest possible code, but organised. A human auditor must be able to read it like prose.
- **Auditability**: document the *why*, not the *what*. A human must be able to understand, audit and use the project with no prior knowledge of its history.
- **Security**: treated at the same level as functionality, never an afterthought.
- **User-friendly at every level**: end user, developer, and Claude itself when stuck. If Claude hits a limit, make the problem as easy as possible to understand and unblock — do not work around it silently.
- **Atomic PRs**: 1 PR = 1 logical change, for a readable `git log` and precise rollbacks.
- **Transparency**: if uncertain, say so and propose options with arguments. Never claim something is impossible unless 100% certain.
- **Decisions**: any change that affects observable behaviour or a config file requires explicit approval. Minor changes (typos, internal variable names, comments) can be done without asking — but must be signalled.
- **Constructive challenge**: if Claude disagrees with an approach or sees a better way, say so clearly and argue the point. If the user holds their position, accept it — but if new evidence emerges later, revisit and try to convince again.
- **Resilience**: always tend toward maximum resilience. Include explicit error logs so failures can be diagnosed without replaying the whole pipeline. Proactively flag resilience gaps and propose fixes.
- **Do not break what works**: identify what is stable before touching it. Test before modifying. Never trade existing stability for an unvalidated improvement. Ask if the impact of a change is uncertain (build, run, security).
- **Documentation**: a human must be able to do everything alone through the documentation — run the pipeline, create a profile, audit the scoring, debug. Documentation follows the same principles as code: sober, structured, resilient. Document *why* and *failure cases*, not just the happy path.

## Conventions

### Naming (Python)

- `snake_case` — variables, functions, files
- `PascalCase` — classes
- `SCREAMING_SNAKE_CASE` — constants
- Explicit names over short names (`score_offers` not `s_off`, `profile_text` not `pt`)

### Logging

`src/logger.py` configures the root logger. Use `logging.getLogger(__name__)` in each module.

| Level | When to use |
|---|---|
| `DEBUG` | Pagination details, internal loop iterations |
| `INFO` | Normal pipeline progress |
| `WARNING` | Expected skips (missing key, optional dependency absent) |
| `ERROR` | Unexpected exceptions — always pass `exc_info=True` for full traceback |

Override the default level with `LOG_LEVEL=DEBUG` to see pagination details without touching code.

### Commits

- Messages in French
- No `Co-Authored-By` in commits
- 1 commit = 1 clear intent (follows atomic PR logic)
- Approval to commit = implicit approval to push — both are chained automatically. Exception: force push, shared branch, or secret detected in the diff.

## Collaboration

The user is not a professional developer — they learn by working with Claude. Adapt the level of explanation without being condescending. If Claude is stuck or uncertain, make the problem as simple as possible to understand and unblock rather than working around it.

The user has granted full permissions on all project files and folders — no need to ask for confirmation before reading, writing, or running commands in the project.

**File and folder creation**: act autonomously anywhere in the project (including `.claude/`). Summarise what was created at the end.

**Deletion**:
- *Minor* (temp file, duplicate, unused artefact): act autonomously. Summarise what was removed.
- *Major* (entire module, profile folder, workflow, test file, anything that affects functionality or history): ask for confirmation first, explain clearly why it is major so the user can make an informed decision.

### Progress on multi-step tasks

Use the Task tracking system (TaskCreate / TaskUpdate) for any task with 3 or more steps so the user can see progress without asking.

### End-of-session summary

When work naturally concludes, give a 2–3 line recap: what changed, current project state, and the next logical action if one exists.

## Local environment setup

```bash
# One-time setup (after cloning)
direnv allow          # loads .venv + .env automatically on cd
pip install -r requirements.txt
pre-commit install
```

`direnv allow` must be run once per clone. After that, the virtualenv and `.env` variables load automatically on `cd` into the project.

## Commands

```bash
# Install dependencies
pip install -r requirements.txt

# Run all tests
pytest

# Run a single test file
pytest tests/test_scoring.py

# Lint
ruff check src/ scripts/ tests/

# Type check
pyright

# Format
black src/ scripts/ tests/

# Build offers (auto-detects the single profile in profiles/)
python scripts/build_offers.py

# Build a specific profile
python scripts/build_offers.py --profile <profileId>

# Build all profiles + regenerate docs/profiles.json
# If one profile fails, the pipeline continues on the others and returns a non-zero exit code at the end.
python scripts/build_offers.py --all

# Delete a profile (removes profiles/<id>/, docs/<id>/, updates profiles.json)
./scripts/delete_profile.sh <profileId>

# CLI one-shot search (writes offers.json)
python -m src.main search --keyword "développeur" --location "Lille" --config profiles/<id>/scoring.config.json
```

## Slash commands

Defined in `.claude/commands/`. Invoke them in any Claude Code session with `/command-name`.

| Command | Purpose |
|---|---|
| `/build` | Build pipeline for the current profile (or all profiles if several exist) |
| `/test` | Run pytest, explain failures |
| `/check` | Full quality gate: ruff → black --check → pyright → pytest (stops at first failure) |
| `/fix` | Auto-fix style issues: `ruff --fix` + `black` |
| `/commit` | Stage relevant files, write a French commit message, commit + push |
| `/pr` | Create a GitHub PR for the current branch via MCP GitHub |

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `FRANCE_TRAVAIL_CLIENT_ID` | Yes | OAuth client ID for France Travail API |
| `FRANCE_TRAVAIL_CLIENT_SECRET` | Yes | OAuth client secret |
| `ANTHROPIC_API_KEY` | No | LLM re-rank step — skipped if absent |
| `API_APPRENTISSAGE_KEY` | No | La Bonne Alternance API — skipped if absent |
| `LOG_LEVEL` | No | Logging verbosity (`DEBUG`, `INFO`, `WARNING`, `ERROR`) — default `INFO` |

These same variables must be configured as **GitHub Actions secrets** (repo Settings → Secrets and variables → Actions) for the `build-profile.yml` and `refresh.yml` workflows to work.

## Testing

### What is covered

| Module | Test file | Approach |
|---|---|---|
| `src/dedup.py` | `test_dedup.py` | Unit — normalisation, merging, freshness |
| `src/france_travail.py` | `test_france_travail.py` | Unit — parsing fixtures, contract mapping |
| `src/scoring.py` | `test_scoring.py` | Unit — all scoring components |
| `src/semantic.py` | `test_semantic.py` | Unit — cosine similarity, enrichment with `FakeModel` |
| `src/rerank.py` | `test_rerank.py` | Unit — JSON extraction, LLM call with `FakeAnthropic` mock |
| `src/la_bonne_alternance.py` | `test_la_bonne_alternance.py` | Unit — parsing fixture, LBA-specific cases |
| `src/exporter.py` | `test_exporter.py` | Unit — serialisation, encoding, directory creation |
| `scripts/apply_profile_config.py` | `test_apply_profile_config.py` | Unit — profileId validation, selective file writing, error cases |

No integration tests — all tests use local fixtures or mocks. No real API calls are made.

### Conventions

- Use a `make_offer(**kwargs)` helper in each test file to build minimal `JobOffer` fixtures.
- Mock external clients (Anthropic, sentence-transformers) via simple classes, not `unittest.mock`. See `FakeAnthropic` and `FakeModel` for the pattern.
- Write a test for any new function that contains logic. Pure data-mapping functions (e.g. `map_offer`) are covered via fixture parsing.
- Do not write tests for config loading or file I/O — test the logic that consumes the parsed data instead.

## Security

### Concrete attack surfaces in this project

- **`profileId` in `apply_profile_config.py`**: validated (alphanumeric, max 32 chars) before being used to build file paths. Do not relax this validation — it prevents path traversal.
- **`profile.md` content**: sent as-is to Claude Haiku in `rerank.py`. This is a prompt injection surface — a malicious profile could attempt to manipulate the LLM output. Acceptable risk for a single-user tool; revisit if the project becomes multi-tenant.
- **API keys**: loaded from `.env` or environment only. Never hardcode or log them. The `.env` file is in `.gitignore`.

## Architecture

### Pipeline (`scripts/build_offers.py`)

The main orchestrator runs a 6-step pipeline per profile:

1. **Fan-out search** — runs N searches defined in `search.config.json` against France Travail and/or La Bonne Alternance, collects `list[JobOffer]`.
2. **Fuzzy dedup** (`src/dedup.py`) — groups offers by normalised (title, location) key, keeps the freshest per group.
3. **Semantic enrichment** (`src/semantic.py`) — encodes `profile.md` + each offer with `paraphrase-multilingual-MiniLM-L12-v2`, writes cosine similarity into `offer.semantic_score`. **First run downloads ~120 MB** to `~/.cache/huggingface/` — cached afterwards (GitHub Actions caches this folder too).
4. **Scoring** (`src/scoring.py`) — sums keyword, contract type, ROME code, location, freshness, and semantic components defined in `scoring.config.json`.
5. **LLM re-rank** (`src/rerank.py`) — sends batches of 40 offers + the profile to Claude Haiku 4.5, which returns a ranked list with one-sentence reasons. Writes `offer.llm_rank` and `offer.llm_reason`.
6. **Export** (`src/exporter.py`) — writes `docs/<profileId>/offers.json` consumed by the frontend.

### Profile layout

```
profiles/
  <profileId>/
    meta.json           # {"label": "Job title shown in UI"}
    profile.md          # Free-text candidate profile (drives semantic + LLM steps)
    search.config.json  # Search parameters
    scoring.config.json # Scoring weights and rules (falls back to scoring.example.json at repo root if absent)

docs/
  <profileId>/
    offers.json         # Build output — read by the frontend
  profiles.json         # Manifest listing all profiles (generated by --all)
  index.html / app.js / style.css  # Static SPA frontend
```

### `search.config.json` format

```json
{
  "defaults": { "location": "Lille", "radius_km": 25, "max_results": 150 },
  "searches": [
    { "keyword": "développeur", "_label": "Dev", "source": "france_travail" },
    { "rome_codes": ["M1805"], "source": "la_bonne_alternance", "diploma_level": "4" }
  ]
}
```

`source` is `"france_travail"` (default) or `"la_bonne_alternance"`. Each search entry is merged with `defaults`; explicit keys win.

Available search parameters: `keyword`, `rome_code`, `location`, `radius_km`, `max_results`, `contract_type` (CDI/CDD/MIS/SAI), `published_within_days` (1/3/7/14/31), `alternance_only` (bool), `diploma_level` (LBA only).

**France Travail hard cap**: the API returns at most 150 results per search (3 pages of 50). Setting `max_results` above 150 has no effect. To get more coverage, split into multiple searches with different keywords or ROME codes.

**La Bonne Alternance**: single request, no pagination. The API returns all matching offers at once; `max_results` simply slices the Python list after the fact.

### `scoring.config.json` format

```json
{
  "keywords": [
    { "pattern": "python", "weight": 5.0 },
    { "pattern": "django|fastapi", "weight": 3.0 }
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

`pattern` is a Python regex (case-insensitive) matched against `title + snippet`. `semantic_weight` scales the cosine similarity (0–1) — a value of 10 means a perfect semantic match adds 10 points to the total score. Offers with a negative total score are excluded from the output.

### GitHub Actions workflows

| Workflow | Trigger | Purpose |
|---|---|---|
| `build-profile.yml` | Issue opened with title `[job-agent] ` or `[job-agent-rebuild] ` | Creates/updates a profile and rebuilds its offers |
| `refresh.yml` | Daily at 06:00 UTC, or manual dispatch | Rebuilds all profiles; commits with `[skip ci]` if changes exist |
| `deploy.yml` | Triggered by the two above after push | Deploys `docs/` to GitHub Pages |

### GitHub Actions issue JSON format

`build-profile.yml` triggers on issue creation. The issue body must be a valid JSON object. All fields except `profileId` are optional — only present fields are written.

```json
{
  "profileId": "myprofile",
  "poste": "Développeur Python",
  "profileMd": "Je suis développeur avec 5 ans d'expérience en Python…",
  "searchConfig": { "defaults": {}, "searches": [] },
  "scoringConfig": { "keywords": [], "preferred_contracts": {} }
}
```

`profileId` must be alphanumeric, max 32 characters. The workflow creates or updates `profiles/<profileId>/`, runs the build, commits results, deploys to GitHub Pages, and closes the issue.

### Data model (`src/models.py`)

- `JobOffer` — single offer with optional `semantic_score`, `llm_rank`, `llm_reason`.
- `ScoringConfig` — weights for all scoring components; validated with Pydantic.
- `ScoredOffer` — `(offer, score, score_breakdown)` tuple.

### Frontend (`docs/`)

Static SPA (vanilla JS, no build step). Reads `docs/profiles.json` to list profiles, then fetches `docs/<profileId>/offers.json`. Supports table/kanban views, status tracking, CSV export, and manual offer addition — all persisted in `localStorage`.

JS modules live in `docs/js/`: `config.js`, `constants.js`, `github-api.js`, `onboarding.js`.

The app is a **PWA** (Progressive Web App) — `docs/manifest.json`, `icon-192.png`, `icon-512.png` and the `theme-color` meta tag make it installable on mobile. When modifying the frontend, do not remove or break these files.

`docs/tracking.json` stores per-offer user data committed to the repo:
```json
{ "<offerId>": { "notes": "", "status": "", "status_date": null } }
```
It is written by the frontend and committed alongside `offers.json` on each build. Do not delete it — it holds the user's application history.

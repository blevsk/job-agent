from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import typer
from rich.console import Console

from . import france_travail
from .dedup import dedupe_offers
from .exporter import export_json
from .france_travail import FranceTravailError, MissingCredentialsError
from .models import ScoringConfig
from .scoring import score_offers

app = typer.Typer(add_completion=False, help="Recherche et scoring d'annonces France Travail.")
console = Console()


def _load_config(path: Path | None) -> ScoringConfig:
    if path is None:
        console.print("[yellow]Aucune config de scoring fournie — valeurs par défaut.[/yellow]")
        return ScoringConfig()
    if not path.exists():
        console.print(f"[red]Config introuvable : {path}[/red]")
        raise typer.Exit(code=2)
    raw = json.loads(path.read_text(encoding="utf-8"))
    return ScoringConfig.model_validate(raw)


@app.command()
def search(
    keyword: str = typer.Option(..., "--keyword", "-k", help="Mots-clés (ex: 'alternance administratif')."),
    location: str = typer.Option(..., "--location", "-l", help="Commune (ex: 'Villeneuve-d'Ascq')."),
    radius: int = typer.Option(25, "--radius", "-r", help="Rayon en km."),
    max_results: int = typer.Option(75, "--max-results", "-n", help="Nombre max d'offres à récupérer."),
    contract_type: str | None = typer.Option(
        None,
        "--contract-type",
        help="Filtre type de contrat France Travail : CDI, CDD, MIS (intérim), SAI. Plusieurs séparés par virgule.",
    ),
    published_within: int | None = typer.Option(
        None,
        "--published-within",
        help="Limiter aux offres publiées depuis N jours (1, 3, 7, 14, 31).",
    ),
    config: Path | None = typer.Option(None, "--config", "-c", help="Chemin vers un fichier ScoringConfig JSON."),
    output: Path = typer.Option(Path("offers.json"), "--output", "-o", help="Chemin du JSON résultat."),
) -> None:
    """Récupère les offres France Travail et exporte un JSON scoré."""
    scoring_config = _load_config(config)

    console.print(
        f"[bold cyan]Recherche France Travail[/bold cyan] : "
        f"keyword=[bold]{keyword}[/bold], location=[bold]{location}[/bold], "
        f"radius={radius}km, max={max_results}"
        + (f", contrat={contract_type}" if contract_type else "")
        + (f", publié depuis {published_within}j" if published_within else "")
    )

    def _on_page(page_idx: int, found: int, new: int) -> None:
        console.print(f"  page {page_idx} → {found} offres ({new} nouvelles)")

    try:
        offers = france_travail.search(
            keyword=keyword,
            location=location,
            radius_km=radius,
            max_results=max_results,
            type_contrat=contract_type,
            published_within_days=published_within,
            on_page=_on_page,
        )
    except MissingCredentialsError as exc:
        console.print(f"[red]{exc}[/red]")
        console.print("[yellow]Voir .env.example pour la marche à suivre.[/yellow]")
        raise typer.Exit(code=2)
    except FranceTravailError as exc:
        console.print(f"[red]Erreur France Travail : {exc}[/red]")
        raise typer.Exit(code=1)

    console.print(f"[green]✓ {len(offers)} offres récupérées[/green]")

    deduped = dedupe_offers(offers)
    if len(deduped) < len(offers):
        console.print(
            f"[green]✓ {len(offers) - len(deduped)} doublons fuzzy retirés "
            f"→ {len(deduped)} offres uniques[/green]"
        )

    scored = score_offers(deduped, scoring_config)

    meta = {
        "source": "france_travail",
        "query": keyword,
        "location": location,
        "radius_km": radius,
        "contract_type": contract_type,
        "published_within_days": published_within,
        "scraped_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
    }
    export_json(scored, output, meta)
    console.print(f"[green]✓ JSON écrit dans {output}[/green]")

    if scored:
        top = scored[0]
        console.print(
            f"[bold]Top match[/bold] (score {top.score:.1f}) : "
            f"{top.offer.title} — {top.offer.company or '?'}"
        )

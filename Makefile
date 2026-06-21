.PHONY: help test lint format build build-all watch coverage coverage-html

help:
	@echo "Cibles disponibles :"
	@echo "  test          Lance pytest"
	@echo "  lint          Vérifie le style avec ruff"
	@echo "  format        Reformate avec black"
	@echo "  build         Build les offres (profil unique auto-détecté)"
	@echo "  build-all     Build tous les profils + profiles.json"
	@echo "  watch         Lance pytest en mode watch (ptw)"
	@echo "  coverage      Rapport de couverture dans le terminal"
	@echo "  coverage-html Rapport HTML + ouverture dans le navigateur"

test:
	pytest -q

lint:
	ruff check src/ scripts/ tests/

format:
	black src/ scripts/ tests/

build:
	python scripts/build_offers.py

build-all:
	python scripts/build_offers.py --all

watch:
	ptw -- -q --tb=short

coverage:
	pytest --cov=src --cov-report=term-missing -q

coverage-html:
	pytest --cov=src --cov-report=html -q && open htmlcov/index.html

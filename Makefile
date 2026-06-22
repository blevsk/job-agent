.PHONY: help test lint format check typecheck build build-all watch coverage coverage-html demo demo-clean

help:
	@echo "Cibles disponibles :"
	@echo "  test          Lance pytest"
	@echo "  lint          Vérifie le style avec ruff"
	@echo "  format        Reformate avec black"
	@echo "  typecheck     Vérifie les types avec pyright"
	@echo "  check         Gate qualité complète : lint + test"
	@echo "  build         Build les offres (profil unique auto-détecté)"
	@echo "  build-all     Build tous les profils + profiles.json"
	@echo "  watch         Lance pytest en mode watch (ptw)"
	@echo "  coverage      Rapport de couverture dans le terminal"
	@echo "  coverage-html Rapport HTML + ouverture dans le navigateur"
	@echo "  demo          Crée le profil démo local (données fictives, sans API)"
	@echo "  demo-clean    Supprime le profil démo local"

test:
	pytest -q

lint:
	ruff check src/ scripts/ tests/

check: lint test

typecheck:
	pyright

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

demo:
	python scripts/setup_demo.py

demo-clean:
	python scripts/setup_demo.py --clean

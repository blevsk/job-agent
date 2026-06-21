.PHONY: test lint format build build-all watch coverage coverage-html

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

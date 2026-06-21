.PHONY: test lint format build build-all watch

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

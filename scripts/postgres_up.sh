#!/usr/bin/env bash
# Sobe PostgreSQL local, aplica DDL, executa o ETL e publica as views.
# Requisitos: docker compose, python 3.10+, pip install -r etl/requirements.txt
# e psql no host para a etapa final de reconciliação (`npm run test:sql`).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
DSN="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/meridian}"

echo "→ PostgreSQL (docker compose)"
docker compose up -d postgres
for _ in $(seq 1 60); do
  if docker compose exec -T postgres psql -U postgres -d meridian -At -c "select 1 from dw.fato_pedido limit 1" >/dev/null 2>&1; then break; fi
  sleep 2
done

echo "→ ETL (full refresh)"
python etl/pipeline_etl.py --dsn "$DSN" --mode full

echo "→ Views de KPI e governança"
docker compose exec -T postgres psql -U postgres -d meridian -v ON_ERROR_STOP=1 < sql/02_views_kpi.sql
docker compose exec -T postgres psql -U postgres -d meridian -v ON_ERROR_STOP=1 < sql/04_governanca.sql

echo "→ Reconciliação painel × SQL"
DATABASE_URL="$DSN" npm run test:sql

echo "Pronto. Power BI: servidor localhost:5432 · banco meridian · schema dw"

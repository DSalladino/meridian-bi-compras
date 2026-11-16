# Estratégia de testes

O objetivo é transformar cada regra de negócio em um teste executável, para que SQL, DAX e
painel não divirjam silenciosamente. A fonte canônica das regras é
[`app/js/kpi.js`](../app/js/kpi.js); o ETL replica as mesmas regras no Python e o PostgreSQL
materializa o OTIF como coluna gerada.

## Pirâmide adotada

| Nível | Arquivo | O que valida |
| --- | --- | --- |
| Unitário | `tests/kpi.test.mjs` | OTIF, spend, saving, HHI, score (inclusive sem histórico), contratos, previsão e simulação |
| Unitário ETL | `etl/test_pipeline.py` | extração, validação, transformação, frete, saving negativo e recorte `--since` |
| Integração do painel | `tests/parity.test.mjs` | `kpis()` e `supplierScorecards()` contra as funções canônicas |
| Ingestão | `tests/upload.test.mjs` | schema, FK, duplicidade, saving negativo e OTIF recalculado |
| Exportação | `tests/xlsx.test.mjs` | ZIP store-only, CRC, XML do workbook e escaping CSV |
| Dataset | `scripts/smoke_test.mjs` | 22 verificações de integridade e faixas de KPI |
| Banco real | `scripts/verify_sql_kpis.mjs` | `vw_kpi_geral`, `vw_contrato_gestao` e `vw_integridade_checklist` |

## Execução local

```bash
npm test                 # 21 testes Node
npm run check            # smoke test do dataset
npm run test:etl         # unittest do ETL (requer pandas)
npm run test:sql         # requer DATABASE_URL e psql
```

Para a reconciliação SQL:

```bash
docker compose up -d postgres
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/meridian
python etl/pipeline_etl.py --dsn "$DATABASE_URL" --mode full
psql "$DATABASE_URL" -f sql/02_views_kpi.sql
psql "$DATABASE_URL" -f sql/04_governanca.sql
npm run test:sql
```

## Casos de borda cobertos

- Pedido cancelado com data de entrega: não entra em spend, OTIF ou taxa de defeito.
- Entrega parcial: nunca é OTIF, mesmo com `atraso_dias = 0`.
- Saving negativo (sobrepreço): preservado no upload, no ETL e no Power Query.
- Fornecedor sem entrega ou sem cotação vencedora: score nulo, não 0 nem 0,5 artificial.
- Fornecedor com 3 pilares: pesos renormalizados.
- Contrato vencido com pedido em aberto: alerta crítico e exposição financeira.
- Previsão com série linear: tendência correta e banda não negativa.
- Simulação: economia incremental e nova taxa calculadas sem divisão por zero.

## Integração contínua

[`ci.yml`](../.github/workflows/ci.yml) tem dois jobs:

1. **web** — Node 22, `npm test` e `npm run check`.
2. **etl-sql** — PostgreSQL 16 como service, testes Python, DDL, carga full, views, `test:sql`,
   carga incremental e validação do log/checklist.

A publicação da demonstração é feita por [`pages.yml`](../.github/workflows/pages.yml).

## Fora do escopo automatizado

- Renderização visual pixel a pixel (o painel é validado por teste de renderização e checklist manual).
- Geração do PDF (depende da engine de impressão do navegador).
- Testes de carga com dezenas de milhões de linhas.
- SCD tipo 2 e CDC de ERP, que exigiriam uma origem real.

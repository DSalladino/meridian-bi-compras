# Estratégia de testes

O objetivo é transformar cada regra de negócio em um teste executável, para que SQL, DAX e
painel não divirjam silenciosamente. A fonte canônica das regras é
[`app/js/kpi.js`](../app/js/kpi.js); o ETL replica as mesmas regras no Python e o PostgreSQL
materializa o OTIF como coluna gerada.

## Pirâmide adotada

| Nível | Arquivo | O que valida |
| --- | --- | --- |
| Estático | `eslint.config.mjs` | código morto, global implícita, `var` e comparação frouxa (não é estilo) |
| Unitário | `tests/kpi.test.mjs` | OTIF, spend, saving, HHI, score (inclusive sem histórico), contratos, previsão e simulação |
| Unitário ETL | `etl/test_pipeline.py` | extração, validação, transformação, frete, saving negativo e recorte `--since` |
| Integração do painel | `tests/parity.test.mjs` | `kpis()` e `supplierScorecards()` contra as funções canônicas |
| Ingestão | `tests/upload.test.mjs` | schema, FK, duplicidade, saving negativo e OTIF recalculado |
| Importação de ERP | `tests/importador.test.mjs` | número/data localizados, tradução de status, derivação de dimensões/preços e validação |
| Configuração | `tests/config.test.mjs` | metas em fração/percentual, fallback e prazos de contrato |
| Autenticação | `tests/auth.test.mjs` | scrypt, sessão assinada, expiração, rate limit e cookies |
| SSO/OIDC | `tests/oidc.test.mjs` | assinatura/nonce/issuer/audience, PKCE S256, papéis e fluxo completo com IdP falso |
| Produção | `tests/prod.test.mjs` | login, RBAC, escopo, importação, rejeição, usuários, auditoria e exportação |
| Exportação | `tests/xlsx.test.mjs` | ZIP store-only, CRC, XML do workbook e escaping CSV |
| Dataset | `scripts/smoke_test.mjs` | 22 verificações de integridade e faixas de KPI |
| Banco real | `scripts/verify_sql_kpis.mjs` | `vw_kpi_geral`, `vw_contrato_gestao` e `vw_integridade_checklist` |

## Execução local

```bash
npm ci && npm run lint   # ESLint (devDependencies)
npm test                 # 41 testes Node (KPI, ERP, auth, OIDC, produção e exportação)
npm run check            # smoke test do dataset demo
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

- Número `1.234,56`, data `dd/mm/aaaa`, status em inglês e flag `SIM/NÃO` transformados
  para o contrato canônico; dimensões ausentes derivadas com aviso explícito.
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

1. **web** — Node 22, `npm ci`, `npm run lint`, `npm test` e `npm run check`.
2. **etl-sql** — PostgreSQL 16 como service, testes Python, DDL, carga full, views, as 15
   consultas analíticas de `sql/03_queries_analiticas.sql`, `test:sql`, carga incremental e
   validação do log/checklist.

O job também falha se uma coluna `NOT NULL` sem default ficar fora da lista de carga do ETL —
proteção que existe desde que `dw.fato_cotacao.id_cotacao` (PK `IDENTITY`) quebrava a carga
full no staging.

A camada de produção adiciona um teste de integração HTTP real (`tests/prod.test.mjs`):
servidor efêmero, login, cookie, escopo por unidade, importação, rejeição, auditoria,
backup, gestão de usuários e exportação. O fluxo SSO tem um teste próprio com um provedor
OIDC falso (discovery, JWKS, PKCE e `id_token`). Nenhum banco é necessário.

A publicação da demonstração é feita por [`pages.yml`](../.github/workflows/pages.yml).

## Fora do escopo automatizado

- Renderização visual pixel a pixel (o painel é validado por teste de renderização e checklist manual).
- Geração do PDF (depende da engine de impressão do navegador).
- Testes de carga com dezenas de milhões de linhas.
- MFA/TOTP e logout federado (single logout) do provedor SSO.
- SCD tipo 2 e CDC de ERP, que exigiriam uma origem real.

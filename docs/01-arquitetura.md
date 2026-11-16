# Arquitetura da solução

## Visão geral

```
┌───────────────────────────────┐
│  Fontes (simuladas)           │
│  ERP de compras · cotações    │
│  cadastro de fornecedores     │
│  orçamento · notas fiscais    │
└──────────────┬────────────────┘
               │ CSV / extração
┌──────────────▼────────────────┐
│  RAW  /data                   │  dataset versionado, imutável por seed
│  contrato de schema + escaping│
└──────────────┬────────────────┘
               │ etl/pipeline_etl.py
┌──────────────▼────────────────┐
│  VALIDATE                     │  schema, PK, FK, domínios, regras de negócio
│  → quality_report.json        │  erro bloqueia a carga; aviso segue com log
└──────────────┬────────────────┘
               │ transform
┌──────────────▼────────────────┐
│  GOLD  PostgreSQL `dw`        │  modelo estrela + views de KPI
│  dim_* / fato_*               │  índices por data, fornecedor e categoria
└───────┬───────────────┬───────┘
        │               │
┌───────▼──────┐  ┌─────▼─────────────────┐
│ Power BI     │  │ Painel web (SPA)      │
│ modelo + DAX │  │ SVG, XLSX, PDF, upload│
└──────────────┘  └───────────────────────┘
```

O repositório entrega **duas camadas de consumo** sobre o mesmo modelo semântico:

1. **Power BI** — modelo import (ou DirectQuery) com o tema pastel e as medidas em `dax/`.
2. **Painel web** — implementação executável e portátil, usada como demonstração viva do
   produto. Não é um mock: os números vêm do mesmo dataset e as definições de KPI são as
   mesmas das views SQL.

## Componentes

| Componente | Responsabilidade | Tecnologia |
| --- | --- | --- |
| `scripts/generate_dataset.mjs` | geração determinística do dataset | Node 18+, sem dependências |
| `etl/generate_data.py` | geração equivalente em Python | Python 3.11+ |
| `etl/pipeline_etl.py` | validação, tratamento e carga | pandas + psycopg2 |
| `sql/01_ddl.sql` | modelo estrela, constraints e índices | PostgreSQL 16 |
| `sql/02_views_kpi.sql` | camada semântica reutilizável | SQL |
| `app/` | dashboard analítico | HTML, CSS e ES Modules |
| `server.js` | servidor estático local | Node `http` |
| `powerbi/` | tema e guia do modelo | JSON + Markdown |

## Fluxo de dados

1. **Extract** — cada tabela é lida como texto (`dtype=str`) para que nenhum valor seja
   silenciosamente convertido; datas e números são convertidos com `errors="coerce"` para
   que a validação veja o problema em vez de escondê-lo.
2. **Validate** — 30+ verificações, classificadas em `error` (bloqueia) e `warning`
   (permite carga com registro).
3. **Transform** — normalização de tipos, recomposição do frete a partir de
   `valor_total − quantidade × valor_unitario`, derivação de `mes_ref` e
   `saving_potencial`.
4. **Load** — `TRUNCATE` + `execute_values` em ordem de dependência, dentro de uma
   transação única. Falha em qualquer tabela desfaz o lote.
5. **Report** — `etl/out/quality_report.json` com contagens, checks e timestamp UTC.

## Modelo de atualização

- **Histórico**: o dataset cobre jan/2024 → out/2026. A carga é full refresh por ser
  pequena (≈ 17 mil linhas); em produção, o desenho suporta incremental por `mes_ref`.
- **Agendamento recomendado**: diário às 05:00 (cron/Agendador) com carga full para dims e
  incremental por data para fatos; atualização do Power BI 30 min depois.
- **Idempotência**: a carga trunca e reescreve; o mesmo CSV produz o mesmo resultado.
  No painel, uploads são idempotentes por `id_pedido` (substitui, não duplica).

## Desempenho

| Cenário | Estratégia |
| --- | --- |
| Filtros do painel | uma passada por `fato_pedido` (~3 mil linhas), agregações em memória |
| Cotações (11 mil linhas) | agrupamento por `id_requisicao` sob demanda |
| Gráficos | SVG puro; nenhuma biblioteca, nenhum canvas, re-render < 50 ms |
| Excel | geração OOXML no cliente, 5 abas, ~3 MB |
| PDF | impressão vetorial do relatório A4, 2 páginas |
| PostgreSQL | índices em `data_emissao`, `id_fornecedor`, `id_categoria`, `mes_ref`; views prontas para materialização |

## Segurança e acesso

- Nenhuma credencial no repositório; DSN via `DATABASE_URL`.
- O servidor estático faz *path traversal check* e envia `X-Content-Type-Options: nosniff`.
- Dados sintéticos: não há PII real. Em um cenário produtivo, o cadastro de fornecedores
  (CNPJ, contatos) entraria em colunas mascaradas + controle de acesso por linha no Power BI
  (RLS por unidade/centro de custo).
- Upload é local ao navegador; nenhum arquivo é enviado a servidor.

## Extensões previstas

- Camada **bronze** com ingestão direta do ERP (CDC) e **silver** com deduplicação.
- *Feature store* de fornecedores para modelo de risco (prazo × qualidade × financeiro).
- Publicação do painel como app interno com autenticação SSO e trilha de auditoria.

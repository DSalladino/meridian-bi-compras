# Meridian BI · Compras & Gestão de Fornecedores

Solução de Business Intelligence de ponta a ponta para a área de **Suprimentos** de um grupo
industrial fictício (Grupo Meridian). Cobre ingestão, tratamento, modelagem dimensional,
indicadores de negociação e desempenho, e um painel analítico interativo com estética pastel,
exportação em Excel/PDF e upload de dados.

> Dados **fictícios, mas realistas**: 34 meses de operação, 123 fornecedores, 3.120 pedidos,
> 11.416 propostas e R$ 78,9 mi de spend (economia líquida de 8,4%). Nada de dados de curso — o objetivo é simular a
> rotina de uma área de compras com metas, desvios, atrasos, reajustes e política de contratos.

---

## O que está pronto

| Camada | Entrega |
| --- | --- |
| **Dataset** | 10 arquivos CSV determinísticos em `/data` (seed fixa), geração em Node e Python |
| **ETL** | `etl/pipeline_etl.py` com regras de qualidade, tratamento e carga no PostgreSQL |
| **SQL** | DDL do modelo estrela, views de KPI e 12 consultas analíticas prontas |
| **DAX** | ~50 medidas documentadas (spend, savings, OTIF, HHI, score, preço, tempo) |
| **Power BI** | Tema pastel (`powerbi/tema-pastel.json`) + guia de modelo e páginas |
| **Dashboard** | SPA em HTML/CSS/JS puro (sem build), 6 páginas, 9 tipos de gráfico, filtros globais |
| **Relatórios** | Excel nativo (`.xlsx`, 5 abas, formatação e filtros) e PDF A4 executivo |
| **Ingestão** | Upload de CSV com validação de schema, chaves, tipos e regras de negócio |

---

## Começar em 30 segundos

```bash
npm start          # sobe o servidor local em http://localhost:4173
# ou: node server.js
```

Requisitos: **Node 18+** para o painel (zero dependências). Para o pipeline Python:
`pip install -r etl/requirements.txt` e um PostgreSQL 16.

```
http://localhost:4173/app/       painel analítico
http://localhost:4173/app/#dados upload, dicionário e exportações
```

---

## As 6 páginas do painel

1. **Visão executiva** — spend vs. orçamento, economia, OTIF, concentração, heatmap
   categoria × mês e leituras automáticas (insights) do período filtrado.
2. **Cotações & economia** — funil de negociação, economia por categoria, dispersão
   preço vencedor × referência, top itens por saving e tabela de propostas.
3. **Fornecedores** — matriz spend × OTIF com bolha por volume e cor por risco, radar dos
   4 pilares, ranking por score composto, geografia e piores OTIF.
4. **Prazos & qualidade** — OTIF mensal contra meta de 90%, atraso médio por categoria,
   distribuição de atrasos, lead time, defeitos e pedidos em aberto.
5. **Preços & reajustes** — índice por categoria, variação 12 meses, série do item
   selecionado e monitor de exposição financeira.
6. **Dados & exportação** — upload validado, dicionário, qualidade e central de exportação.

Filtros globais: período (com intervalo personalizado), unidade, categoria, comprador,
fornecedor e status do pedido. Tudo recalcula na hora, inclusive os deltas contra o
período anterior de mesmo tamanho.

---

## Indicadores principais

| Indicador | Definição | Meta |
| --- | --- | --- |
| **Spend** | Σ valor total dos pedidos não cancelados | orçamento |
| **Economia (savings)** | Σ (preço de referência − preço negociado) × quantidade | 6% do spend |
| **Aderência ao orçamento** | spend ÷ orçamento | ≤ 100% |
| **OTIF** | entregas no prazo, completas e sem defeito ÷ entregas | ≥ 90% |
| **Lead time** | dias entre emissão e entrega real | por categoria |
| **Concentração top 5 / HHI** | participação dos 5 maiores / Σ(share²) × 10.000 | HHI < 1.800 |
| **Cobertura contratual** | spend com contrato ÷ spend total | ≥ 85% |
| **Cotações por requisição** | propostas ÷ requisições | ≥ 3 |
| **Variação de preços 12m** | preço atual ÷ preço de 12 meses − 1, ponderado por spend | ≤ IPCA |
| **Score de fornecedor** | prazo 35% + qualidade 25% + preço 25% + conformidade 15% | ≥ 70 |

A árvore completa de KPIs, fórmulas em SQL/DAX e decisões de definição estão em
[`docs/03-kpis-e-analises.md`](docs/03-kpis-e-analises.md).

---

## Estrutura do repositório

```
├── app/                  painel analítico (HTML/CSS/JS, sem dependências)
│   ├── css/theme.css     design tokens pastel, componentes, impressão A4
│   └── js/               dados, gráficos SVG, páginas, XLSX, PDF, upload
├── data/                 dataset versionado (CSVs com separador ';')
├── dax/medidas.dax       medidas DAX do modelo Power BI
├── docs/                 arquitetura, modelo, KPIs, decisões e governança
├── etl/                  geração (Node/Python), validação e carga PostgreSQL
├── powerbi/              tema pastel + guia do modelo
├── scripts/              gerador determinístico do dataset
├── sql/                  DDL, views de KPI e consultas analíticas
└── server.js             servidor estático local (porta 4173)
```

---

## Como os dados foram construídos

O gerador (`scripts/generate_dataset.mjs`, espelhado em `etl/generate_data.py`) aplica:

- **sazonalidade** (pico no Q4, vale em janeiro) e crescimento de ~0,35% ao mês;
- **inflação por categoria** (aço +0,55%/mês, TI +0,18%/mês) refletida no preço de referência;
- **competitividade por fornecedor** (fator log-normal) e 12% de decisões que não escolhem
  o menor preço — qualidade e relacionamento também pesam;
- **execução realista**: 79% de OTIF, atraso correlacionado ao rating, defeitos raros,
  pedidos em trânsito/parciais nos meses recentes;
- **orçamento** derivado do realizado com desvio controlado, permitindo estouros localizados;
- **contratos** com vigência, reajuste e índice, e ~34% de compras fora de contrato.

Os CSVs são gravados com escaping RFC 4180 (aspas em descrições como `Tubo 2"`).

```bash
npm run data                      # regenera o dataset (Node, seed 20261116)
python etl/generate_data.py       # equivalente em Python
python etl/pipeline_etl.py --validate-only
python etl/pipeline_etl.py --dsn postgresql://postgres:postgres@localhost:5432/meridian
```

---

## Decisões técnicas (resumo)

- **Modelo estrela com grão explícito** por pedido; cotações em fato separado para preservar
  o grão da negociação e permitir medir spread e aderência ao menor preço.
- **Savings sobre preço de referência**, nunca sobre “primeira cotação” — o baseline é
  auditável e estável ao longo do tempo.
- **OTIF como flag no grão do pedido**, calculado na origem e validado no ETL (regra
  reconcilia prazo, completude e qualidade).
- **Painel sem framework**: SVG feito à mão e XLSX OOXML gerado no navegador (sem CDN,
  sem dependências) para garantir portabilidade e um artefato que abre em qualquer máquina.
- **Estética pastel com hierarquia funcional**: cores suaves só como codificação
  (categoria, risco, status), texto em alto contraste, números tabulares e alvos ≥ 32 px.

Detalhamento e alternativas descartadas em [`docs/04-decisoes-tecnicas.md`](docs/04-decisoes-tecnicas.md).

---

## Escopo e limites (transparência)

- Os arquivos `.pbix` **não** estão versionados (binário proprietário). O que está no repo é o
  que importa para reproduzir: modelo, medidas DAX, tema e layout documentado — veja
  [`powerbi/README.md`](powerbi/README.md).
- O PDF é produzido pela engine de impressão do navegador (layout A4 dedicado), garantindo
  fontes e gráficos vetoriais sem servidor.
- Uploads ficam no `localStorage` do navegador; o recálculo é imediato, mas não persiste em
  um banco. Em produção, o mesmo schema é carregado pelo pipeline Python.

---

## Próximos passos sugeridos

1. Publicar o modelo no Power BI Service com gateway para o PostgreSQL e atualização agendada.
2. Adicionar **previsão de spend** (séries temporais) e simulação de cenários de renegociação.
3. Integrar ERP (SAP/Oracle) via camada bronze e substituir o CSV pelo CDC.
4. Criar alertas de reajuste acima do índice contratual e SLA de homologação de fornecedores.

---

*Projeto de portfólio — Enterprise BI. Dados fictícios, sem qualquer vínculo com empresas reais.*

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
| **ETL** | `etl/pipeline_etl.py` (Python) e `powerbi/power-query.m` (M) com qualidade, staging e swap transacional |
| **SQL** | DDL do modelo estrela, views de KPI e 12 consultas analíticas prontas |
| **DAX** | ~50 medidas documentadas (spend, savings, OTIF, HHI, score, preço, tempo) |
| **Power BI / Power Query** | Consultas M de tratamento (`powerbi/power-query.m`), tema pastel e guia de modelo |
| **Dashboard** | SPA em HTML/CSS/JS puro (sem build), 6 páginas, 9 tipos de gráfico, filtros globais |
| **Relatórios** | Excel nativo (`.xlsx`, 5 abas, formatação e filtros) e PDF A4 executivo |
| **Ingestão** | Upload de CSV com validação de schema, chaves, tipos e regras de negócio |
| **Modos de dados** | Dataset demo, base vazia e somente importações, com estados vazios reais e preferência salva |

---

## Começar em 30 segundos

```bash
npm start          # sobe o servidor local em http://localhost:4173
npm run check      # smoke test do dataset (integridade + KPIs de referência)
npm run data       # regenera o dataset a partir da seed 20261116
# ou: node server.js
```

Requisitos: **Node 18+** para o painel (zero dependências). Para o pipeline Python:
`pip install -r etl/requirements.txt` e um PostgreSQL 16.

```
http://localhost:4173/app/       painel analítico
http://localhost:4173/app/#dados upload, dicionário e exportações
```

---

## Demonstração

O painel web é a demonstração executável do projeto: abre sem build, sem CDN e sem
credenciais. As capturas abaixo foram geradas a partir do dataset versionado, com o filtro
padrão de 12 meses.

[![Visão executiva](docs/capturas/visao-executiva.png)](docs/capturas/visao-executiva.png)

| Página | Captura |
| --- | --- |
| Cotações & economia | [abrir](docs/capturas/cotacoes-economia.png) |
| Fornecedores | [abrir](docs/capturas/fornecedores.png) |
| Prazos & qualidade | [abrir](docs/capturas/prazos-qualidade.png) |
| Preços & reajustes | [abrir](docs/capturas/precos-reajustes.png) |
| Dados & exportação | [abrir](docs/capturas/dados-exportacao.png) |

### Reproduzir em 1 minuto

```bash
npm start
# abra http://localhost:4173/app/
```

1. **Visão executiva** — confira spend, economia, aderência, OTIF e concentração.
2. **Dados & exportação** — alterne para **Base vazia** e veja os estados vazios.
3. **Restaurar demo** — a base volta com 3.120 pedidos e 11.416 propostas.
4. **Excel / Relatório PDF** — exporte os filtros ativos.

### E o arquivo `.pbix`?

O `.pbix` é binário e não é versionado. Em vez dele, o repositório entrega o que é
reproduzível: DDL, Power Query M, ~50 medidas DAX, tema e um guia de reconstrução em
[`powerbi/README.md`](powerbi/README.md). O painel web cobre a mesma narrativa analítica e
serve como demonstração imediata para quem não tem o Power BI Desktop instalado.

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

### Modos de dados (demo · vazia · importações)

Na página **Dados & exportação** é possível alternar a fonte sem reiniciar o servidor:

- **Dataset demo** — base versionada de 34 meses, com os uploads locais aplicados.
- **Base vazia** — mantém dimensões e cadastros, zera pedidos, cotações, preços e orçamento.
  Todas as páginas analíticas exibem um estado vazio com atalho para restaurar ou importar.
- **Somente importações** — usa apenas os pedidos importados neste navegador.

A escolha fica em `localStorage` (`meridian.dataMode.v1`). O botão **Zerar fatos** pede
confirmação, mantém os uploads salvos e pode ser revertido com **Restaurar demo**. Para
apagar também as importações, use **Remover importações**. A importação valida o arquivo,
preserva as dimensões e passa automaticamente para o modo de importações.

---

## Indicadores principais

| Indicador | Definição | Meta |
| --- | --- | --- |
| **Spend** | Σ valor total dos pedidos não cancelados | orçamento |
| **Economia (savings)** | Σ (preço de referência − preço negociado) × quantidade | 6% do spend |
| **Aderência ao orçamento** | spend ÷ orçamento | ≤ 100% |
| **OTIF** | entregas no prazo, completas e sem defeito ÷ entregas | ≥ 90% |
| **Lead time** | dias entre emissão e entrega real | por categoria |
| **Concentração top 5 / HHI** | participação dos 5 maiores / Σ(share²) × 10.000 | HHI < 1.500 (competitivo; 1.500–2.500 moderado, > 2.500 concentrado) |
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
├── scripts/              gerador determinístico + smoke test do dataset
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
- **OTIF como flag no grão do pedido**, calculado na origem e validado no ETL (prazo,
  completude e qualidade). No PostgreSQL a coluna é `GENERATED ALWAYS`; no painel o flag é
  recalculado no cliente para não confiar cegamente no CSV.
- **Carga em duas fases**: staging temporário + `TRUNCATE` explícito **sem CASCADE** e swap
  dentro de uma transação. Falha em qualquer etapa desfaz o lote inteiro.
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
- O `server.js` é um servidor de demonstração: publica **apenas** `/app` e `/data`, aplica
  cabeçalhos de segurança e bloqueia traversal/dotfiles. Ele **não implementa login**, RBAC
  nem auditoria. Para exposição real, use a API autenticada descrita na próxima seção.

---

## Próximos passos sugeridos

1. **Login e RBAC**: API com sessão `HttpOnly`, Argon2id/scrypt, papéis (admin, analista,
   comprador, leitor), escopo por unidade/categoria, auditoria de exportações e uploads.
2. Publicar o modelo no Power BI Service com gateway para o PostgreSQL e atualização agendada.
3. Adicionar **previsão de spend** (séries temporais) e simulação de cenários de renegociação.
4. Integrar ERP (SAP/Oracle) via camada bronze e substituir o CSV pelo CDC.
5. Criar alertas de reajuste acima do índice contratual e SLA de homologação de fornecedores.

---

*Projeto de portfólio — Enterprise BI. Dados fictícios, sem qualquer vínculo com empresas reais.*

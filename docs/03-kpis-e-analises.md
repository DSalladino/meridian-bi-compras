# KPIs e análises

## Árvore de indicadores

```
Resultado de Suprimentos
├── Custo
│   ├── Spend (R$)
│   ├── Aderência ao orçamento (%)
│   ├── Economia capturada (R$) e taxa (%)
│   ├── Spread médio das propostas (%)
│   └── Variação de preços 12m (%)
├── Entrega
│   ├── OTIF (%)
│   ├── Atraso médio e P90 (dias)
│   ├── Lead time (dias)
│   └── Pedidos em aberto (R$)
├── Qualidade
│   ├── Taxa de defeito (%)
│   ├── Nota de qualidade (1–5)
│   └── Score composto do fornecedor (0–100)
├── Risco e governança
│   ├── Concentração top 5 (%) e HHI
│   ├── Spend em fornecedores de alto risco (%)
│   ├── Cobertura contratual (%)
│   └── Compras emergenciais / fora de contrato (%)
└── Processo
    ├── Requisições cotadas
    ├── Cotações por requisição
    └── Aderência ao menor preço (%)
```

## Definições e fórmulas

### Spend
Soma de `valor_total` dos pedidos com `status <> 'Cancelado'`. Inclui frete. O pedido
cancelado não é custo — mas permanece na base para medir taxa de cancelamento.

```sql
SELECT sum(valor_total) FROM dw.fato_pedido WHERE status <> 'Cancelado';
```

### Economia (savings)
`(preco_referencia − valor_unitario) × quantidade`. Pode ser **negativo** quando o preço
negociado supera a referência (sobrepreço em compra spot ou emergencial); o total reportado
é líquido. O baseline é o preço de catálogo atualizado pela inflação da categoria — não a
proposta mais cara recebida. Isso evita “economia artificial” e permite comparar meses.

```dax
Economia :=
CALCULATE ( SUM ( fato_pedido[saving_valor] ), fato_pedido[status] <> "Cancelado" )
Taxa Economia := DIVIDE ( [Economia], [Spend] )
```

### Aderência ao orçamento
`spend ÷ orçamento`. Valores acima de 100% indicam estouro; a leitura por categoria mostra
onde o desvio se concentra.

```sql
round(sum(p.valor_total) / nullif(sum(o.orcamento), 0) * 100, 1)
```

### OTIF
`entregas no prazo, completas e sem defeito ÷ entregas com data real e status <> Cancelado`.
“No prazo” = `atraso_dias = 0`; “completo” = `qtd_recebida >= quantidade`;
“sem defeito” = `qtd_defeito = 0`. No PostgreSQL a coluna é `GENERATED ALWAYS`; no ETL,
no DAX e no painel a mesma regra é recalculada para auditoria.

```dax
OTIF :=
VAR Base =
    FILTER (
        fato_pedido,
        NOT ISBLANK ( fato_pedido[data_entrega_real] )
            && fato_pedido[status] = "Entregue"
            && fato_pedido[atraso_dias] = 0
            && fato_pedido[qtd_recebida] >= fato_pedido[quantidade]
            && fato_pedido[qtd_defeito] = 0
    )
RETURN DIVIDE ( COUNTROWS ( Base ), [Entregas] )
```

### Lead time e atraso
Lead time = dias corridos entre emissão e entrega real. Atraso = dias entre previsão e
entrega real. O P90 é usado no painel porque a média esconde a cauda longa de atrasos.

### Concentração e HHI
`share_i = spend_i ÷ spend_total`; `HHI = Σ share_i² × 10.000`.
Referência antitruste adotada no projeto: < 1.500 competitivo, 1.500–2.500 moderado,
> 2.500 concentrado. A meta do painel é **< 1.500**; o README usa a mesma escala.

```dax
HHI Fornecedores :=
VAR Total = [Spend]
VAR PorFornecedor = ADDCOLUMNS ( VALUES ( dim_fornecedor[id_fornecedor] ), "@spend", [Spend] )
RETURN ROUND ( SUMX ( FILTER ( PorFornecedor, [@spend] > 0 ), DIVIDE ( [@spend], Total ) ^ 2 ) * 10000, 0 )
```

### Cobertura contratual
`spend com tem_contrato = true ÷ spend total`. O complemento é tratado como *maverick
buying* e aparece como insight quando supera 12%.

### Competitividade e score de fornecedor
Competitividade = média de `1 − preco_unitario / preco_referencia` nas propostas vencedoras.
O score combina quatro pilares:

| Pilar | Peso | Cálculo |
| --- | ---: | --- |
| Prazo | 35% | OTIF do fornecedor |
| Qualidade | 25% | `1 − min(1, taxa_defeito × 25)` |
| Preço | 25% | `clamp(0,5 + competitividade × 2,4; 0; 1)` |
| Conformidade | 15% | `rating/100 × 0,7 + cobertura_contratual × 0,3` |

Classificação: ≥85 Estratégico · 70–84,9 Preferencial · 55–69,9 Aprovado · <55 Em desenvolvimento.

**Fornecedor sem histórico:** pilar sem dados é excluído e os pesos restantes são
renormalizados. O score só é publicado com **3 ou mais pilares**; com menos, o retorno é
nulo e a interface exibe “sem histórico suficiente”. Assim um fornecedor novo (sem entregas
ou sem proposta vencedora) não é premiado com 0,5 artificial nem penalizado com zero.

Exemplos cobertos por teste:

| Situação | Pilares | Resultado |
| --- | ---: | --- |
| Entregas + qualidade + preço | 4 | score normal |
| Entregas + qualidade, sem cotação vencedora | 3 | pesos renormalizados |
| Sem entrega, com cotação | 2 | `null` / sem histórico |
| Sem fato nenhum | 1 | `null` / sem histórico |

### Variação de preços 12 meses
Por item: `preço_atual ÷ preço_12_meses_atrás − 1`. O agregado é ponderado pelo spend do
item, não pela média simples — um item caro não distorce o índice.

### Spread médio das propostas
`(maior_total − menor_total) ÷ maior_total` por requisição. Mede a dispersão do mercado e
a qualidade do processo de cotação.

### Gestão contratual

A carteira é calculada com a referência de data = **fim do mês do fato mais recente** (a mesma
`store.maxDate` do painel, considerando pedidos, preços e orçamento):

| Indicador | Fórmula |
| --- | --- |
| Situação | Futuro / Vigente / A vencer (≤ 90 dias) / Vencido / Suspenso |
| Realizado | pedidos não cancelados do mesmo fornecedor + categoria dentro de `data_inicio` e `data_fim` |
| Saldo | `valor_anual − realizado` |
| Execução | `realizado ÷ valor_anual` |
| Exposição | pedidos em aberto (Em trânsito, Parcial, Atrasado) emitidos após `data_fim` |
| Alerta crítico | vencido **com** pedido ativo após o vencimento |
| Alerta de reajuste | `reajuste_pct > 5%` (limite configurável do projeto) |

O vínculo usa fornecedor + categoria + vigência porque `fato_pedido` não carrega
`id_contrato`. Contratos sobrepostos podem exigir a chave explícita em produção.

### Previsão de spend

Regressão linear sobre os últimos 6 meses com spend > 0. A projeção de 3 meses usa a
tendência e uma banda de **1,5 σ** dos resíduos. O orçamento de referência é a média dos
últimos 3 meses, pois o dataset não tem orçamento futuro. É uma leitura de tendência, não
um modelo sazonal.

### Simulação de renegociação

```
spend_elegivel   = spend × cobertura × (1 + variação_volume)
economia_extra   = spend_elegivel × desconto_adicional
nova_economia    = economia_atual × (spend_elegivel / spend) + economia_extra
novo_spend       = spend × (1 + variação_volume) − economia_extra
nova_taxa        = nova_economia / novo_spend
```

O simulador da página **Cotações & economia** expõe desconto, cobertura e volume e
recalcula no cliente; a mesma lógica existe em DAX (`Economia Incremental Simulada`).

## Metas e limites de alerta

| Indicador | Meta | Atenção | Crítico |
| --- | ---: | ---: | ---: |
| Economia sobre spend | 6% | 4–6% | < 4% |
| OTIF | 90% | 80–90% | < 80% |
| Aderência ao orçamento | ≤ 100% | 100–105% | > 105% |
| Cotações por requisição | 3 | 2–3 | < 2 |
| Cobertura contratual | 85% | 70–85% | < 70% |
| Spend em alto risco | ≤ 5% | 5–10% | > 10% |
| HHI | < 1.500 | 1.500–2.500 | > 2.500 |
| Variação de preços 12m | ≤ IPCA | +2 p.p. | +5 p.p. |
| Contratos a vencer | 0 sem plano | ≤ 90 dias | vencido com pedido ativo |
| Reajuste contratual | ≤ 5% | 5–7% | > 7% |
| Execução contratual | ≤ 90% | 90–100% | > 100% |

## Mapa indicador → página

| Página | Indicadores em destaque |
| --- | --- |
| Visão executiva | spend, economia, aderência, OTIF, lead time, concentração, insights |
| Cotações & economia | requisições, cotações/req, spread, economia, aderência ao menor preço |
| Fornecedores | concentração, HHI, rating, score, cobertura, matriz de risco, OTIF baixo |
| Prazos & qualidade | OTIF, atraso médio/P90, lead time, defeitos, pedidos em aberto |
| Preços | variação 12m, itens em alta/queda, índice por categoria, impacto financeiro |
| Dados | volume, atualidade, qualidade, importações, dicionário |

## Análises que o modelo habilita

- **Curva ABC de fornecedores** (Pareto) e dependência por categoria crítica.
- **Matriz de risco** spend × OTIF, com bolha de volume e cor de risco cadastral.
- **Custo de não-qualidade**: atraso × valor do pedido e dias de atraso acumulados.
- **Gap de meta de savings** por categoria, com valor necessário para atingir 6%.
- **Exposição a reajuste**: variação 12m × spend do item = impacto financeiro estimado.
- **Eficiência do processo**: requisições com menos de 3 propostas, tempo médio de cotação.
- **Maverick buying** por unidade e modalidade, com pedidos emergenciais isolados.

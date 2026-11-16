-- =============================================================================
-- 03_queries_analiticas.sql — consultas de análise (usadas na documentação
-- e na validação dos números do dashboard)
-- =============================================================================

-- 1) Spend, economia e aderência ao orçamento nos últimos 12 meses
SELECT round(sum(p.valor_total), 2)                                        AS spend_12m,
       round(sum(p.saving_valor), 2)                                       AS economia_12m,
       round(sum(p.saving_valor) / sum(p.valor_total) * 100, 2)            AS economia_pct,
       round((SELECT sum(orcamento) FROM dw.fato_orcamento
               WHERE mes_ref >= to_char(current_date - interval '11 months', 'YYYY-MM')) /
             sum(p.valor_total) * 100, 1)                                  AS aderencia_pct
FROM dw.fato_pedido p
WHERE p.status <> 'Cancelado'
  AND p.data_emissao >= (current_date - interval '12 months');

-- 2) Top 10 fornecedores por spend com participação e OTIF
SELECT f.razao_social,
       cat.categoria,
       round(sum(p.valor_total), 2)                                        AS spend,
       round(sum(p.valor_total) / sum(sum(p.valor_total)) OVER () * 100, 2) AS participacao_pct,
       count(*)                                                            AS pedidos,
       round(avg(p.otif) FILTER (WHERE p.data_entrega_real IS NOT NULL) * 100, 1) AS otif_pct
FROM dw.fato_pedido p
JOIN dw.dim_fornecedor f ON f.id_fornecedor = p.id_fornecedor
JOIN dw.dim_categoria cat ON cat.id_categoria = p.id_categoria
WHERE p.status <> 'Cancelado'
GROUP BY f.razao_social, cat.categoria
ORDER BY spend DESC
LIMIT 10;

-- 3) Concentração de fornecimento (HHI) e participação do top 5
WITH share AS (
    SELECT id_fornecedor, sum(valor_total) AS spend
    FROM dw.fato_pedido
    WHERE status <> 'Cancelado'
    GROUP BY id_fornecedor
), rank AS (
    SELECT spend,
           spend / sum(spend) OVER () AS pct,
           row_number() OVER (ORDER BY spend DESC) AS rn
    FROM share
)
SELECT round(sum(pct * pct) * 10000, 0)                                   AS hhi,
       round(sum(pct) FILTER (WHERE rn <= 5) * 100, 1)                    AS top5_pct,
       count(*)                                                           AS fornecedores
FROM rank;

-- 4) OTIF mensal e atraso médio (últimos 12 meses)
SELECT to_char(p.data_emissao, 'YYYY-MM')                                 AS mes,
       count(*)                                                           AS entregas,
       round(avg(p.otif) * 100, 2)                                        AS otif_pct,
       round(avg(p.atraso_dias), 2)                                       AS atraso_medio,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY p.atraso_dias)         AS atraso_p90
FROM dw.fato_pedido p
WHERE p.data_entrega_real IS NOT NULL
  AND p.status <> 'Cancelado'
GROUP BY 1
ORDER BY 1;

-- 5) Fornecedores que mais atrasam (mínimo de 5 entregas)
SELECT f.razao_social,
       count(*)                                                           AS entregas,
       round(avg(p.otif) * 100, 1)                                        AS otif_pct,
       round(avg(p.atraso_dias), 1)                                       AS atraso_medio,
       sum(p.atraso_dias)                                                 AS dias_perdidos
FROM dw.fato_pedido p
JOIN dw.dim_fornecedor f ON f.id_fornecedor = p.id_fornecedor
WHERE p.data_entrega_real IS NOT NULL AND p.status <> 'Cancelado'
GROUP BY f.razao_social
HAVING count(*) >= 5
ORDER BY atraso_medio DESC, dias_perdidos DESC
LIMIT 15;

-- 6) Economia por categoria e aderência ao menor preço
SELECT cat.categoria,
       round(sum(c.quantidade * (c.preco_referencia - c.preco_unitario)), 2) AS economia,
       round(sum(c.quantidade * c.preco_referencia), 2)                      AS baseline,
       round(sum(c.quantidade * (c.preco_referencia - c.preco_unitario)) /
             sum(c.quantidade * c.preco_referencia) * 100, 2)               AS economia_pct
FROM dw.fato_cotacao c
JOIN dw.dim_categoria cat ON cat.id_categoria = c.id_categoria
WHERE c.selecionada = 1
GROUP BY cat.categoria
ORDER BY economia DESC;

-- 7) Requisições com menos de 3 propostas (risco de competitividade)
SELECT r.id_requisicao, r.data_cotacao, cat.categoria,
       r.propostas, r.spread_pct, r.saving_pct
FROM dw.vw_requisicao_negociacao r
JOIN dw.dim_categoria cat ON cat.id_categoria = r.id_categoria
WHERE r.propostas < 3
ORDER BY r.data_cotacao DESC
LIMIT 50;

-- 8) Compras fora de contrato (maverick buying) por unidade
SELECT u.unidade,
       round(sum(p.valor_total) FILTER (WHERE NOT p.tem_contrato), 2)      AS spend_fora_contrato,
       round(sum(p.valor_total), 2)                                        AS spend_total,
       round(sum(p.valor_total) FILTER (WHERE NOT p.tem_contrato) /
             sum(p.valor_total) * 100, 1)                                  AS fora_contrato_pct,
       count(*) FILTER (WHERE NOT p.tem_contrato AND p.modalidade = 'Emergencial') AS pedidos_emergenciais
FROM dw.fato_pedido p
JOIN dw.dim_unidade u ON u.id_unidade = p.id_unidade
WHERE p.status <> 'Cancelado'
GROUP BY u.unidade
ORDER BY fora_contrato_pct DESC;

-- 9) Itens com maior pressão de preço (12 meses) e exposição de spend
SELECT i.descricao,
       cat.categoria,
       round(max(v.preco_medio), 2)                                        AS preco_atual,
       max(v.variacao_12m_pct)                                             AS variacao_12m_pct,
       round(sum(p.valor_total), 2)                                        AS spend_12m,
       round(sum(p.valor_total) * max(v.variacao_12m_pct) / 100, 2)        AS impacto_financeiro
FROM dw.vw_preco_variacao v
JOIN dw.dim_item i ON i.id_item = v.id_item
JOIN dw.dim_categoria cat ON cat.id_categoria = v.id_categoria
LEFT JOIN dw.fato_pedido p ON p.id_item = v.id_item
     AND p.mes_ref = v.mes_ref AND p.status <> 'Cancelado'
WHERE v.variacao_12m_pct IS NOT NULL
  AND v.mes_ref = (SELECT max(mes_ref) FROM dw.fato_preco)
GROUP BY i.descricao, cat.categoria
ORDER BY impacto_financeiro DESC NULLS LAST
LIMIT 15;

-- 10) Prazo médio de pagamento ponderado (DPO aproximado) por fornecedor
SELECT f.razao_social,
       round(sum(p.valor_total * f.prazo_pagamento_dias) / sum(p.valor_total), 1) AS pmp_dias,
       round(sum(p.valor_total), 2) AS spend
FROM dw.fato_pedido p
JOIN dw.dim_fornecedor f ON f.id_fornecedor = p.id_fornecedor
WHERE p.status <> 'Cancelado'
GROUP BY f.razao_social
HAVING sum(p.valor_total) > 500000
ORDER BY spend DESC
LIMIT 15;

-- 11) Clientes internos: spend por comprador e categoria (matriz)
SELECT k.comprador,
       cat.categoria,
       round(sum(p.valor_total), 2) AS spend,
       count(*) AS pedidos
FROM dw.fato_pedido p
JOIN dw.dim_comprador k ON k.id_comprador = p.id_comprador
JOIN dw.dim_categoria cat ON cat.id_categoria = p.id_categoria
WHERE p.status <> 'Cancelado'
  AND p.data_emissao >= (current_date - interval '12 months')
GROUP BY k.comprador, cat.categoria
ORDER BY spend DESC;

-- 12) Curva ABC de fornecedores (Pareto)
WITH s AS (
    SELECT f.razao_social, sum(p.valor_total) AS spend
    FROM dw.fato_pedido p
    JOIN dw.dim_fornecedor f ON f.id_fornecedor = p.id_fornecedor
    WHERE p.status <> 'Cancelado'
    GROUP BY f.razao_social
), r AS (
    SELECT razao_social, spend,
           sum(spend) OVER (ORDER BY spend DESC) / sum(spend) OVER () AS acumulado
    FROM s
)
SELECT razao_social, round(spend, 2) AS spend,
       round(acumulado * 100, 1) AS acumulado_pct,
       CASE WHEN acumulado <= 0.8 THEN 'A' WHEN acumulado <= 0.95 THEN 'B' ELSE 'C' END AS classe_abc
FROM r
ORDER BY spend DESC;

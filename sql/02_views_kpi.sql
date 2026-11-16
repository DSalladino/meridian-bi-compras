-- =============================================================================
-- 02_views_kpi.sql — camada semântica reutilizável (views materializáveis)
-- Pré-requisito: 01_ddl.sql carregado com os CSVs de /data
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Spend e economia por mês
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW dw.vw_spend_mensal AS
SELECT p.mes_ref,
       c.ano,
       c.mes,
       count(*)                                   AS pedidos,
       sum(p.valor_total)                         AS spend,
       sum(p.saving_valor)                        AS saving,
       round(sum(p.saving_valor) / nullif(sum(p.valor_total), 0) * 100, 2) AS saving_pct,
       sum(p.valor_total) FILTER (WHERE p.tem_contrato) AS spend_contrato,
       sum(p.valor_total) FILTER (WHERE NOT p.tem_contrato) AS spend_sem_contrato
FROM dw.fato_pedido p
JOIN dw.dim_calendario c ON c.data = p.data_emissao
WHERE p.status <> 'Cancelado'
GROUP BY p.mes_ref, c.ano, c.mes;

-- ---------------------------------------------------------------------------
-- Resultado por categoria (spend, economia, prazo, qualidade)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW dw.vw_categoria_kpi AS
WITH base AS (
    SELECT p.*,
           coalesce(p.data_entrega_real, p.data_entrega_prevista) AS entrega_ref,
           nullif(p.qtd_recebida, 0) AS recebido
    FROM dw.fato_pedido p
    WHERE p.status <> 'Cancelado'
)
SELECT cat.id_categoria,
       cat.categoria,
       cat.grupo,
       cat.criticidade,
       count(*)                                                  AS pedidos,
       sum(b.valor_total)                                        AS spend,
       sum(b.saving_valor)                                       AS saving,
       round(sum(b.saving_valor) / nullif(sum(b.valor_total), 0) * 100, 2) AS saving_pct,
       count(DISTINCT b.id_fornecedor)                           AS fornecedores,
       round(avg(b.atraso_dias) FILTER (WHERE b.data_entrega_real IS NOT NULL), 2) AS atraso_medio_dias,
       round(avg(b.entrega_ref - b.data_emissao) FILTER (WHERE b.data_entrega_real IS NOT NULL), 1) AS lead_time_dias,
       round(avg(b.otif) FILTER (WHERE b.data_entrega_real IS NOT NULL) * 100, 2) AS otif_pct,
       round(sum(b.qtd_defeito) / nullif(sum(b.qtd_recebida), 0) * 100, 3) AS defeito_pct
FROM base b
JOIN dw.dim_categoria cat ON cat.id_categoria = b.id_categoria
GROUP BY cat.id_categoria, cat.categoria, cat.grupo, cat.criticidade;

-- ---------------------------------------------------------------------------
-- Scorecard de fornecedores (mesma lógica do painel)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW dw.vw_fornecedor_scorecard AS
WITH ped AS (
    SELECT p.id_fornecedor,
           count(*)                        AS pedidos,
           sum(p.valor_total)              AS spend,
           sum(p.saving_valor)             AS saving,
           avg(p.atraso_dias) FILTER (WHERE p.data_entrega_real IS NOT NULL) AS atraso_medio,
           avg(p.otif) FILTER (WHERE p.data_entrega_real IS NOT NULL)        AS otif,
           avg(p.nota_qualidade)                                             AS nota_media,
           sum(p.qtd_recebida)                                               AS recebido,
           sum(p.qtd_defeito)                                                AS defeito,
           avg(p.tem_contrato::int)                                          AS cobertura_contrato,
           max(p.data_emissao)                                               AS ultimo_pedido
    FROM dw.fato_pedido p
    WHERE p.status <> 'Cancelado'
    GROUP BY p.id_fornecedor
),
cot AS (
    SELECT id_fornecedor,
           avg(1 - preco_unitario / nullif(preco_referencia, 0)) AS competitividade
    FROM dw.fato_cotacao
    WHERE selecionada = 1
    GROUP BY id_fornecedor
)
SELECT f.id_fornecedor,
       f.razao_social,
       cat.categoria,
       f.uf,
       f.porte,
       f.risco,
       f.rating_cadastral,
       p.pedidos,
       p.spend,
       p.saving,
       round(p.saving / nullif(p.spend, 0) * 100, 2)                 AS saving_pct,
       round(p.otif * 100, 2)                                        AS otif_pct,
       round(p.atraso_medio, 2)                                      AS atraso_medio_dias,
       round(p.defeito / nullif(p.recebido, 0) * 100, 3)             AS defeito_pct,
       round(p.cobertura_contrato * 100, 1)                          AS cobertura_contrato_pct,
       round(c.competitividade * 100, 2)                             AS competitividade_pct,
       round(
           (coalesce(p.otif, 0) * 0.35
          + (1 - least(1, coalesce(p.defeito / nullif(p.recebido, 0), 0) * 25)) * 0.25
          + greatest(0, least(1, 0.5 + coalesce(c.competitividade, 0) * 2.4)) * 0.25
          + (f.rating_cadastral / 100.0 * 0.7 + coalesce(p.cobertura_contrato, 0) * 0.3) * 0.15
           ) * 100, 1)                                              AS score,
       p.ultimo_pedido
FROM ped p
JOIN dw.dim_fornecedor f ON f.id_fornecedor = p.id_fornecedor
JOIN dw.dim_categoria cat ON cat.id_categoria = f.id_categoria
LEFT JOIN cot c ON c.id_fornecedor = f.id_fornecedor;

-- ---------------------------------------------------------------------------
-- Aderência orçamentária por mês / categoria / unidade
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW dw.vw_orcamento_aderencia AS
WITH real AS (
    SELECT mes_ref, id_categoria, id_unidade, sum(valor_total) AS spend
    FROM dw.fato_pedido
    WHERE status <> 'Cancelado'
    GROUP BY mes_ref, id_categoria, id_unidade
)
SELECT o.mes_ref,
       c.categoria,
       u.unidade,
       o.orcamento,
       o.forecast,
       coalesce(r.spend, 0)                                     AS spend,
       coalesce(r.spend, 0) - o.orcamento                       AS variacao_abs,
       round((coalesce(r.spend, 0) / nullif(o.orcamento, 0) - 1) * 100, 2) AS variacao_pct
FROM dw.fato_orcamento o
JOIN dw.dim_categoria c ON c.id_categoria = o.id_categoria
JOIN dw.dim_unidade u ON u.id_unidade = o.id_unidade
LEFT JOIN real r ON r.mes_ref = o.mes_ref AND r.id_categoria = o.id_categoria AND r.id_unidade = o.id_unidade;

-- ---------------------------------------------------------------------------
-- Variação de preços (12 meses) com window function
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW dw.vw_preco_variacao AS
WITH serie AS (
    SELECT p.id_item,
           i.descricao,
           p.id_categoria,
           p.mes_ref,
           p.preco_medio,
           lag(p.preco_medio, 12) OVER (PARTITION BY p.id_item ORDER BY p.mes_ref) AS preco_12m,
           lag(p.preco_medio, 1)  OVER (PARTITION BY p.id_item ORDER BY p.mes_ref) AS preco_mes_anterior
    FROM dw.fato_preco p
    JOIN dw.dim_item i ON i.id_item = p.id_item
)
SELECT s.*,
       round((s.preco_medio / nullif(s.preco_12m, 0) - 1) * 100, 2)        AS variacao_12m_pct,
       round((s.preco_medio / nullif(s.preco_mes_anterior, 0) - 1) * 100, 2) AS variacao_mes_pct
FROM serie s;

-- ---------------------------------------------------------------------------
-- Eficiência da negociação por requisição
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW dw.vw_requisicao_negociacao AS
WITH agg AS (
    SELECT id_requisicao,
           count(*)                                        AS propostas,
           min(valor_total)                                AS menor_total,
           max(valor_total)                                AS maior_total,
           sum(valor_total) FILTER (WHERE selecionada = 1) AS total_escolhido,
           sum(quantidade * preco_referencia)               AS total_referencia,
           max(id_fornecedor) FILTER (WHERE selecionada = 1) AS fornecedor_vencedor,
           max(id_categoria)                               AS id_categoria,
           min(data_cotacao)                               AS data_cotacao
    FROM dw.fato_cotacao
    GROUP BY id_requisicao
)
SELECT a.*,
       a.fornecedor_vencedor = (SELECT c2.id_fornecedor FROM dw.fato_cotacao c2
                                WHERE c2.id_requisicao = a.id_requisicao
                                ORDER BY c2.valor_total LIMIT 1)          AS venceu_menor_preco,
       round((a.maior_total - a.menor_total) / nullif(a.maior_total, 0) * 100, 2) AS spread_pct,
       round((a.total_referencia - a.total_escolhido) / nullif(a.total_referencia, 0) * 100, 2) AS saving_pct
FROM agg a;

-- ---------------------------------------------------------------------------
-- Auditoria da regra de OTIF (deve retornar zero linhas)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW dw.vw_otif_auditoria AS
SELECT p.id_pedido,
       p.status,
       p.atraso_dias,
       p.quantidade,
       p.qtd_recebida,
       p.qtd_defeito,
       p.otif,
       CASE WHEN p.status = 'Entregue'
             AND p.atraso_dias = 0
             AND p.qtd_recebida >= p.quantidade
             AND p.qtd_defeito = 0
            THEN 1 ELSE 0 END AS otif_recalculado
FROM dw.fato_pedido p
WHERE p.otif IS DISTINCT FROM
      (CASE WHEN p.status = 'Entregue'
             AND p.atraso_dias = 0
             AND p.qtd_recebida >= p.quantidade
             AND p.qtd_defeito = 0
            THEN 1 ELSE 0 END);
COMMENT ON VIEW dw.vw_otif_auditoria IS 'Auditoria: toda linha aqui representa divergência entre o OTIF gerado e a regra canônica';

-- ---------------------------------------------------------------------------
-- Snapshot executivo (uma linha) — usado para validar o dashboard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW dw.vw_kpi_geral AS
SELECT
    (SELECT sum(valor_total) FROM dw.fato_pedido WHERE status <> 'Cancelado')        AS spend_total,
    (SELECT sum(saving_valor) FROM dw.fato_pedido WHERE status <> 'Cancelado')       AS saving_total,
    (SELECT sum(orcamento) FROM dw.fato_orcamento)                                   AS orcamento_total,
    (SELECT round(avg(otif)::numeric, 4) FROM dw.fato_pedido WHERE data_entrega_real IS NOT NULL AND status <> 'Cancelado') AS otif,
    (SELECT count(*) FROM dw.vw_otif_auditoria)                                    AS otif_divergencias,
    (SELECT round(avg(atraso_dias)::numeric, 2) FROM dw.fato_pedido WHERE data_entrega_real IS NOT NULL AND status <> 'Cancelado') AS atraso_medio,
    (SELECT count(DISTINCT id_fornecedor) FROM dw.fato_pedido WHERE status <> 'Cancelado') AS fornecedores_ativos,
    (SELECT round(sum(valor_total) FILTER (WHERE tem_contrato) / nullif(sum(valor_total), 0) * 100, 2)
       FROM dw.fato_pedido WHERE status <> 'Cancelado')                              AS cobertura_contrato_pct;

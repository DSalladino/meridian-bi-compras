-- =============================================================================
-- 02_views_kpi.sql — camada semântica reutilizável (views materializáveis)
-- Pré-requisito: 01_ddl.sql carregado com os CSVs de /data
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Spend e economia por mês
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW dw.vw_spend_mensal AS
SELECT to_char(p.data_emissao, 'YYYY-MM') AS mes_ref,
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
GROUP BY 1, c.ano, c.mes;

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
-- Score: prazo 35%, qualidade 25%, preço 25%, conformidade 15%.
-- Pilares sem histórico são excluídos, os pesos restantes são renormalizados
-- e o score só é publicado com pelo menos 3 pilares (mesma regra do app/DAX).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW dw.vw_fornecedor_scorecard AS
WITH ped AS (
    SELECT p.id_fornecedor,
           count(*)                        AS pedidos,
           count(*) FILTER (WHERE p.data_entrega_real IS NOT NULL) AS entregas,
           sum(p.valor_total)              AS spend,
           sum(p.saving_valor)             AS saving,
           avg(p.atraso_dias) FILTER (WHERE p.data_entrega_real IS NOT NULL) AS atraso_medio,
           avg(p.otif) FILTER (WHERE p.data_entrega_real IS NOT NULL)        AS otif,
           avg(p.nota_qualidade)                                             AS nota_media,
           sum(p.qtd_recebida) FILTER (WHERE p.data_entrega_real IS NOT NULL) AS recebido,
           sum(p.qtd_defeito) FILTER (WHERE p.data_entrega_real IS NOT NULL)  AS defeito,
           sum(p.valor_total) FILTER (WHERE p.tem_contrato)                  AS spend_contrato,
           max(p.data_emissao)                                               AS ultimo_pedido
    FROM dw.fato_pedido p
    WHERE p.status <> 'Cancelado'
    GROUP BY p.id_fornecedor
),
cot AS (
    SELECT id_fornecedor,
           count(*) AS propostas,
           avg(1 - preco_unitario / nullif(preco_referencia, 0)) AS competitividade
    FROM dw.fato_cotacao
    WHERE selecionada = 1 AND preco_referencia > 0
    GROUP BY id_fornecedor
),
parts AS (
    SELECT f.id_fornecedor,
           f.razao_social,
           cat.categoria,
           f.uf,
           f.porte,
           f.risco,
           f.rating_cadastral,
           p.pedidos,
           p.entregas,
           p.spend,
           p.saving,
           p.atraso_medio,
           p.otif,
           p.recebido,
           p.defeito,
           p.spend_contrato,
           p.ultimo_pedido,
           c.propostas,
           c.competitividade,
           CASE WHEN p.entregas > 0 THEN p.otif END AS prazo,
           CASE WHEN p.recebido > 0
                THEN 1 - least(1, coalesce(p.defeito / nullif(p.recebido, 0), 0) * 25)
           END AS qualidade,
           CASE WHEN c.propostas > 0
                THEN greatest(0, least(1, 0.5 + coalesce(c.competitividade, 0) * 2.4))
           END AS preco,
           least(1,
                 f.rating_cadastral / 100.0 * 0.7
                 + coalesce(p.spend_contrato / nullif(p.spend, 0), 0) * 0.3
           ) AS conformidade,
           (CASE WHEN p.entregas > 0 THEN 1 ELSE 0 END
          + CASE WHEN p.recebido > 0 THEN 1 ELSE 0 END
          + CASE WHEN c.propostas > 0 THEN 1 ELSE 0 END
          + 1) AS pilares,
           (CASE WHEN p.entregas > 0 THEN 0.35 ELSE 0 END
          + CASE WHEN p.recebido > 0 THEN 0.25 ELSE 0 END
          + CASE WHEN c.propostas > 0 THEN 0.25 ELSE 0 END
          + 0.15) AS peso_disponivel
    FROM ped p
    JOIN dw.dim_fornecedor f ON f.id_fornecedor = p.id_fornecedor
    JOIN dw.dim_categoria cat ON cat.id_categoria = f.id_categoria
    LEFT JOIN cot c ON c.id_fornecedor = f.id_fornecedor
)
SELECT id_fornecedor,
       razao_social,
       categoria,
       uf,
       porte,
       risco,
       rating_cadastral,
       pedidos,
       entregas,
       spend,
       saving,
       round(saving / nullif(spend, 0) * 100, 2)                     AS saving_pct,
       round(otif * 100, 2)                                          AS otif_pct,
       round(atraso_medio, 2)                                        AS atraso_medio_dias,
       round(defeito / nullif(recebido, 0) * 100, 3)                 AS defeito_pct,
       round(coalesce(spend_contrato / nullif(spend, 0), 0) * 100, 1) AS cobertura_contrato_pct,
       round(competitividade * 100, 2)                               AS competitividade_pct,
       prazo,
       qualidade,
       preco,
       conformidade,
       pilares,
       peso_disponivel,
       CASE WHEN pilares >= 3 THEN
           round((coalesce(prazo, 0) * 0.35
                + coalesce(qualidade, 0) * 0.25
                + coalesce(preco, 0) * 0.25
                + conformidade * 0.15) / nullif(peso_disponivel, 0) * 100, 1)
       END AS score,
       CASE WHEN pilares >= 3 THEN
           CASE
               WHEN round((coalesce(prazo, 0) * 0.35
                         + coalesce(qualidade, 0) * 0.25
                         + coalesce(preco, 0) * 0.25
                         + conformidade * 0.15) / nullif(peso_disponivel, 0) * 100, 1) >= 85 THEN 'Estratégico'
               WHEN round((coalesce(prazo, 0) * 0.35
                         + coalesce(qualidade, 0) * 0.25
                         + coalesce(preco, 0) * 0.25
                         + conformidade * 0.15) / nullif(peso_disponivel, 0) * 100, 1) >= 70 THEN 'Preferencial'
               WHEN round((coalesce(prazo, 0) * 0.35
                         + coalesce(qualidade, 0) * 0.25
                         + coalesce(preco, 0) * 0.25
                         + conformidade * 0.15) / nullif(peso_disponivel, 0) * 100, 1) >= 55 THEN 'Aprovado'
               ELSE 'Em desenvolvimento'
           END
       ELSE 'Sem histórico suficiente'
       END AS classificacao,
       ultimo_pedido
FROM parts;

-- ---------------------------------------------------------------------------
-- Aderência orçamentária por mês / categoria / unidade
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW dw.vw_orcamento_aderencia AS
WITH real AS (
    SELECT to_char(data_emissao, 'YYYY-MM') AS mes_ref, id_categoria, id_unidade,
           sum(valor_total) AS spend
    FROM dw.fato_pedido
    WHERE status <> 'Cancelado'
    GROUP BY 1, id_categoria, id_unidade
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
-- Gestão contratual: vencimento, saldo, execução e exposição
-- Data de referência = fim do mês do fato mais recente (a mesma usada pelo dashboard).
-- O vínculo pedido-contrato é fornecedor + categoria + vigência, pois o fato
-- não carrega id_contrato. Em contratos sobrepostos, o realizado pode ser
-- atribuído a mais de um contrato; a evolução recomendada é persistir a chave.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW dw.vw_contrato_gestao AS
WITH ref AS (
    -- Fim do mês do fato mais recente: mesma referência do painel (store.maxDate).
    SELECT (date_trunc('month', greatest(
               coalesce((SELECT max(data_emissao) FROM dw.fato_pedido), current_date),
               coalesce((SELECT max(to_date(mes_ref || '-01', 'YYYY-MM-DD')) FROM dw.fato_preco), current_date),
               coalesce((SELECT max(to_date(mes_ref || '-01', 'YYYY-MM-DD')) FROM dw.fato_orcamento), current_date)
           )) + interval '1 month - 1 day')::date AS asof
),
realizado AS (
    SELECT c.id_contrato,
           count(p.id_pedido)                    AS pedidos,
           coalesce(sum(p.valor_total), 0)       AS realizado
    FROM dw.dim_contrato c
    LEFT JOIN dw.fato_pedido p
           ON p.id_fornecedor = c.id_fornecedor
          AND p.id_categoria = c.id_categoria
          AND p.data_emissao BETWEEN c.data_inicio AND c.data_fim
          AND p.status <> 'Cancelado'
    GROUP BY c.id_contrato
),
ativos AS (
    SELECT c.id_contrato,
           count(p.id_pedido)                    AS pedidos_ativos_pos_vencimento,
           coalesce(sum(p.valor_total), 0)       AS exposicao
    FROM dw.dim_contrato c
    JOIN dw.fato_pedido p
      ON p.id_fornecedor = c.id_fornecedor
     AND p.id_categoria = c.id_categoria
     AND p.data_emissao > c.data_fim
     AND p.status IN ('Em trânsito', 'Parcial', 'Atrasado')
    GROUP BY c.id_contrato
),
base AS (
    SELECT c.*,
           ref.asof,
           r.pedidos,
           r.realizado,
           coalesce(a.pedidos_ativos_pos_vencimento, 0) AS pedidos_ativos_pos_vencimento,
           coalesce(a.exposicao, 0)                     AS exposicao,
           CASE
               WHEN c.status = 'Suspenso' THEN 'Suspenso'
               WHEN c.status = 'Encerrado' AND c.data_fim >= ref.asof THEN 'Encerrado'
               WHEN c.data_inicio > ref.asof THEN 'Futuro'
               WHEN c.data_fim < ref.asof THEN 'Vencido'
               WHEN c.data_fim <= ref.asof + 90 THEN 'A vencer'
               ELSE 'Vigente'
           END AS situacao,
           c.data_fim - ref.asof AS dias_para_vencimento
    FROM dw.dim_contrato c
    CROSS JOIN ref
    LEFT JOIN realizado r ON r.id_contrato = c.id_contrato
    LEFT JOIN ativos a ON a.id_contrato = c.id_contrato
)
SELECT id_contrato,
       id_fornecedor,
       id_categoria,
       data_inicio,
       data_fim,
       valor_anual,
       reajuste_pct,
       indice_reajuste,
       status,
       situacao,
       dias_para_vencimento,
       pedidos,
       realizado,
       valor_anual - realizado AS saldo,
       round(realizado / nullif(valor_anual, 0) * 100, 1) AS execucao_pct,
       pedidos_ativos_pos_vencimento,
       exposicao,
       (situacao = 'Vencido' AND pedidos_ativos_pos_vencimento > 0) AS alerta_vencido_com_pedido,
       (situacao = 'A vencer')                                      AS alerta_a_vencer,
       (reajuste_pct > 5)                                           AS alerta_reajuste,
       (realizado / nullif(valor_anual, 0) > 0.9)                   AS alerta_execucao
FROM base;
COMMENT ON VIEW dw.vw_contrato_gestao IS 'Carteira contratual com situação, saldo, execução, exposição e alertas; asof = fim do mês do fato mais recente';

-- ---------------------------------------------------------------------------
-- Snapshot executivo (uma linha) — usado para validar o dashboard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW dw.vw_kpi_geral AS
SELECT
    (SELECT sum(valor_total) FROM dw.fato_pedido WHERE status <> 'Cancelado')        AS spend_total,
    (SELECT sum(saving_valor) FROM dw.fato_pedido WHERE status <> 'Cancelado')       AS saving_total,
    (SELECT sum(orcamento) FROM dw.fato_orcamento)                                   AS orcamento_total,
    (SELECT round(avg(otif)::numeric, 4) FROM dw.fato_pedido WHERE data_entrega_real IS NOT NULL AND status <> 'Cancelado') AS otif,
    (SELECT count(*) FROM dw.fato_pedido WHERE data_entrega_real IS NOT NULL AND status <> 'Cancelado') AS entregas,
    (SELECT count(*) FROM dw.vw_otif_auditoria)                                    AS otif_divergencias,
    (SELECT round(avg(atraso_dias)::numeric, 2) FROM dw.fato_pedido WHERE data_entrega_real IS NOT NULL AND status <> 'Cancelado') AS atraso_medio,
    (SELECT count(DISTINCT id_fornecedor) FROM dw.fato_pedido WHERE status <> 'Cancelado') AS fornecedores_ativos,
    (SELECT round(sum(valor_total) FILTER (WHERE tem_contrato) / nullif(sum(valor_total), 0) * 100, 2)
       FROM dw.fato_pedido WHERE status <> 'Cancelado')                              AS cobertura_contrato_pct,
    (SELECT count(*) FROM dw.vw_contrato_gestao WHERE situacao = 'Vigente')          AS contratos_vigentes,
    (SELECT count(*) FROM dw.vw_contrato_gestao WHERE situacao = 'A vencer')         AS contratos_a_vencer_90d,
    (SELECT count(*) FROM dw.vw_contrato_gestao WHERE situacao = 'Vencido')          AS contratos_vencidos,
    (SELECT count(*) FROM dw.vw_contrato_gestao WHERE alerta_vencido_com_pedido)     AS contratos_vencidos_com_pedido,
    (SELECT coalesce(sum(valor_anual), 0) FROM dw.vw_contrato_gestao)                AS valor_contratado,
    (SELECT coalesce(sum(realizado), 0) FROM dw.vw_contrato_gestao)                  AS realizado_contratado,
    (SELECT coalesce(sum(saldo), 0) FROM dw.vw_contrato_gestao)                      AS saldo_contratual,
    (SELECT coalesce(sum(exposicao), 0) FROM dw.vw_contrato_gestao)                  AS exposicao_contratual;

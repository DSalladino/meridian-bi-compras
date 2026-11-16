-- =============================================================================
-- 04_governanca.sql — histórico de cargas, auditoria e parâmetros
-- Execute após 01_ddl.sql e 02_views_kpi.sql.
-- =============================================================================

CREATE TABLE IF NOT EXISTS dw.etl_run_log (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz,
    mode            varchar(12) NOT NULL CHECK (mode IN ('full', 'incremental')),
    status          varchar(12) NOT NULL CHECK (status IN ('running', 'success', 'failed')),
    since_date      date,
    rows_loaded     jsonb NOT NULL DEFAULT '{}'::jsonb,
    message         text
);
COMMENT ON TABLE dw.etl_run_log IS 'Histórico de execuções do ETL: modo, status, recorte e contagem por tabela';

CREATE INDEX IF NOT EXISTS ix_etl_run_log_started ON dw.etl_run_log (started_at DESC);
CREATE INDEX IF NOT EXISTS ix_etl_run_log_status ON dw.etl_run_log (status, started_at DESC);

-- Última execução bem-sucedida por modo (para painel de operação).
CREATE OR REPLACE VIEW dw.vw_etl_ultima_execucao AS
SELECT DISTINCT ON (mode)
       mode, started_at, finished_at, since_date, rows_loaded, message,
       (finished_at - started_at) AS duracao
FROM dw.etl_run_log
WHERE status = 'success'
ORDER BY mode, finished_at DESC NULLS LAST;

-- Reconciliação rápida entre CSV (contagens esperadas) e camada gold.
CREATE OR REPLACE VIEW dw.vw_reconciliacao_contagens AS
SELECT 'fato_pedido' AS tabela, count(*) AS linhas FROM dw.fato_pedido
UNION ALL SELECT 'fato_cotacao', count(*) FROM dw.fato_cotacao
UNION ALL SELECT 'fato_preco', count(*) FROM dw.fato_preco
UNION ALL SELECT 'fato_orcamento', count(*) FROM dw.fato_orcamento
UNION ALL SELECT 'dim_fornecedor', count(*) FROM dw.dim_fornecedor
UNION ALL SELECT 'dim_item', count(*) FROM dw.dim_item
UNION ALL SELECT 'dim_contrato', count(*) FROM dw.dim_contrato;

-- Checklist de integridade que deve retornar zero em todas as linhas.
CREATE OR REPLACE VIEW dw.vw_integridade_checklist AS
SELECT 'otif_divergente' AS checagem, count(*) AS ocorrencias FROM dw.vw_otif_auditoria
UNION ALL
SELECT 'cotacao_sem_vencedora', count(*) FROM (
    SELECT id_requisicao FROM dw.fato_cotacao GROUP BY id_requisicao HAVING sum(selecionada) <> 1
) x
UNION ALL
SELECT 'cotacao_com_duas_vencedoras', count(*) FROM (
    SELECT id_requisicao FROM dw.fato_cotacao GROUP BY id_requisicao HAVING sum(selecionada) > 1
) x
UNION ALL
SELECT 'pedido_sem_orcamento', count(*) FROM (
    SELECT DISTINCT p.mes_ref, p.id_categoria, p.id_unidade
    FROM dw.fato_pedido p
    LEFT JOIN dw.fato_orcamento o
      ON o.mes_ref = p.mes_ref AND o.id_categoria = p.id_categoria AND o.id_unidade = p.id_unidade
    WHERE p.status <> 'Cancelado' AND o.mes_ref IS NULL
) x
UNION ALL
SELECT 'contrato_sem_fornecedor', count(*)
FROM dw.dim_contrato c LEFT JOIN dw.dim_fornecedor f USING (id_fornecedor)
WHERE f.id_fornecedor IS NULL;
COMMENT ON VIEW dw.vw_integridade_checklist IS 'Cada linha deve retornar ocorrencias = 0; usado pelo CI e pelo monitoramento';

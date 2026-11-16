-- =============================================================================
-- Meridian BI · Compras & Gestão de Fornecedores
-- 01_ddl.sql — modelo estrela (camada gold) para PostgreSQL 16
-- Execute: psql -d meridian -f sql/01_ddl.sql
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS dw;
COMMENT ON SCHEMA dw IS 'Camada gold — modelo dimensional de compras e fornecedores';

DROP TABLE IF EXISTS dw.fato_preco, dw.fato_orcamento, dw.fato_cotacao, dw.fato_pedido,
                     dw.dim_contrato, dw.dim_fornecedor, dw.dim_item, dw.dim_categoria,
                     dw.dim_comprador, dw.dim_unidade, dw.dim_calendario CASCADE;

-- ---------------------------------------------------------------------------
-- DIMENSÕES
-- ---------------------------------------------------------------------------
CREATE TABLE dw.dim_calendario (
    data            date PRIMARY KEY,
    ano             smallint NOT NULL,
    mes             smallint NOT NULL,
    nome_mes        varchar(12) NOT NULL,
    ano_mes         char(7) NOT NULL,
    trimestre       smallint NOT NULL,
    semana_iso      smallint NOT NULL,
    dia_semana      smallint NOT NULL,
    nome_dia        varchar(14) NOT NULL,
    eh_dia_util     boolean NOT NULL,
    eh_feriado      boolean NOT NULL DEFAULT false
);
COMMENT ON TABLE dw.dim_calendario IS 'Calendário contínuo 2023-01-01 a 2027-12-31, sem lacunas';

INSERT INTO dw.dim_calendario
SELECT d::date,
       EXTRACT(year FROM d)::smallint,
       EXTRACT(month FROM d)::smallint,
       trim(to_char(d, 'TMMonth')),
       to_char(d, 'YYYY-MM'),
       EXTRACT(quarter FROM d)::smallint,
       EXTRACT(week FROM d)::smallint,
       EXTRACT(isodow FROM d)::smallint,
       trim(to_char(d, 'TMDay')),
       EXTRACT(isodow FROM d) NOT IN (6, 7),
       false
FROM generate_series('2023-01-01'::date, '2027-12-31'::date, interval '1 day') d;

CREATE TABLE dw.dim_unidade (
    id_unidade  char(2) PRIMARY KEY,
    unidade     varchar(60) NOT NULL,
    cidade      varchar(60) NOT NULL,
    uf          char(2) NOT NULL,
    tipo        varchar(40) NOT NULL
);

CREATE TABLE dw.dim_comprador (
    id_comprador  char(2) PRIMARY KEY,
    comprador     varchar(80) NOT NULL,
    id_unidade    char(2) NOT NULL REFERENCES dw.dim_unidade (id_unidade),
    categoria_responsavel varchar(60) NOT NULL
);

CREATE TABLE dw.dim_categoria (
    id_categoria          char(2) PRIMARY KEY,
    categoria             varchar(60) NOT NULL UNIQUE,
    grupo                 varchar(30) NOT NULL,
    criticidade           varchar(10) NOT NULL CHECK (criticidade IN ('Alta', 'Média', 'Baixa')),
    natureza              varchar(30) NOT NULL,
    peso_spend            numeric(5, 2) NOT NULL,
    drift_mensal          numeric(6, 4) NOT NULL,
    lead_time_base_dias   smallint NOT NULL CHECK (lead_time_base_dias > 0)
);
COMMENT ON COLUMN dw.dim_categoria.drift_mensal IS 'Inflação média mensal esperada da categoria (usada no baseline de preços)';

CREATE TABLE dw.dim_item (
    id_item           char(4) PRIMARY KEY,
    descricao         varchar(90) NOT NULL,
    id_categoria      char(2) NOT NULL REFERENCES dw.dim_categoria (id_categoria),
    unidade_medida    varchar(14) NOT NULL,
    preco_referencia  numeric(12, 2) NOT NULL CHECK (preco_referencia > 0),
    criticidade       varchar(10) NOT NULL
);

CREATE TABLE dw.dim_fornecedor (
    id_fornecedor          char(4) PRIMARY KEY,
    razao_social           varchar(120) NOT NULL,
    id_categoria           char(2) NOT NULL REFERENCES dw.dim_categoria (id_categoria),
    uf                     char(2) NOT NULL,
    porte                  varchar(12) NOT NULL,
    status                 varchar(20) NOT NULL CHECK (status IN ('Ativo', 'Em homologação', 'Suspenso', 'Inativo')),
    data_homologacao       date NOT NULL,
    prazo_pagamento_dias   smallint NOT NULL,
    iso9001                char(3) NOT NULL CHECK (iso9001 IN ('Sim', 'Não')),
    rating_cadastral       smallint NOT NULL CHECK (rating_cadastral BETWEEN 0 AND 100),
    risco                  varchar(6) NOT NULL CHECK (risco IN ('Baixo', 'Médio', 'Alto')),
    lead_time_medio_dias   smallint NOT NULL
);
CREATE INDEX ix_fornecedor_categoria ON dw.dim_fornecedor (id_categoria);
CREATE INDEX ix_fornecedor_status ON dw.dim_fornecedor (status);

CREATE TABLE dw.dim_contrato (
    id_contrato     varchar(16) PRIMARY KEY,
    id_fornecedor   char(4) NOT NULL REFERENCES dw.dim_fornecedor (id_fornecedor),
    id_categoria    char(2) NOT NULL REFERENCES dw.dim_categoria (id_categoria),
    data_inicio     date NOT NULL,
    data_fim        date NOT NULL,
    valor_anual     numeric(14, 2) NOT NULL CHECK (valor_anual >= 0),
    reajuste_pct    numeric(5, 2) NOT NULL,
    indice_reajuste varchar(10) NOT NULL,
    status          varchar(12) NOT NULL CHECK (status IN ('Vigente', 'Encerrado', 'Suspenso')),
    CONSTRAINT ck_contrato_vigencia CHECK (data_fim > data_inicio)
);
CREATE INDEX ix_contrato_vigencia ON dw.dim_contrato (data_inicio, data_fim);

-- ---------------------------------------------------------------------------
-- FATOS
-- ---------------------------------------------------------------------------
-- Grão: 1 linha por pedido de compra (item/fornecedor/unidade)
CREATE TABLE dw.fato_pedido (
    id_pedido              varchar(16) PRIMARY KEY,
    id_requisicao          varchar(20) NOT NULL,
    data_emissao           date NOT NULL REFERENCES dw.dim_calendario (data),
    mes_ref                char(7) NOT NULL,
    id_fornecedor          char(4) NOT NULL REFERENCES dw.dim_fornecedor (id_fornecedor),
    id_item                char(4) NOT NULL REFERENCES dw.dim_item (id_item),
    id_categoria           char(2) NOT NULL REFERENCES dw.dim_categoria (id_categoria),
    id_comprador           char(2) NOT NULL REFERENCES dw.dim_comprador (id_comprador),
    id_unidade             char(2) NOT NULL REFERENCES dw.dim_unidade (id_unidade),
    quantidade             numeric(14, 3) NOT NULL CHECK (quantidade > 0),
    valor_unitario         numeric(12, 2) NOT NULL CHECK (valor_unitario > 0),
    frete                  numeric(12, 2) NOT NULL DEFAULT 0,
    valor_total            numeric(14, 2) NOT NULL CHECK (valor_total >= 0),
    preco_referencia       numeric(12, 2) NOT NULL,
    saving_valor           numeric(14, 2) NOT NULL DEFAULT 0,   -- pode ser negativo (sobrepreço)
    modalidade             varchar(14) NOT NULL,
    tem_contrato           boolean NOT NULL,
    data_entrega_prevista  date NOT NULL,
    data_entrega_real      date,
    atraso_dias            smallint NOT NULL DEFAULT 0 CHECK (atraso_dias >= 0),
    qtd_recebida           numeric(14, 3) NOT NULL DEFAULT 0,
    qtd_defeito            numeric(14, 3) NOT NULL DEFAULT 0,
    status                 varchar(14) NOT NULL CHECK (status IN ('Entregue', 'Em trânsito', 'Parcial', 'Atrasado', 'Cancelado')),
    otif                   smallint NOT NULL CHECK (otif IN (0, 1)),
    nota_qualidade         numeric(2, 1) CHECK (nota_qualidade BETWEEN 1 AND 5),
    CONSTRAINT ck_pedido_datas CHECK (data_entrega_real IS NULL OR data_entrega_real >= data_emissao),
    CONSTRAINT ck_pedido_recebido CHECK (qtd_recebida <= quantidade * 1.05),
    CONSTRAINT ck_pedido_defeito CHECK (qtd_defeito <= qtd_recebida)
);
COMMENT ON TABLE dw.fato_pedido IS 'Pedidos de compra emitidos. valor_total inclui frete; saving = (referência - negociado) × quantidade, negativo quando houve sobrepreço';
CREATE INDEX ix_pedido_data ON dw.fato_pedido (data_emissao);
CREATE INDEX ix_pedido_fornecedor ON dw.fato_pedido (id_fornecedor);
CREATE INDEX ix_pedido_categoria ON dw.fato_pedido (id_categoria);
CREATE INDEX ix_pedido_status ON dw.fato_pedido (status);
CREATE INDEX ix_pedido_mes ON dw.fato_pedido (mes_ref);

-- Grão: 1 linha por proposta de fornecedor em uma requisição
CREATE TABLE dw.fato_cotacao (
    id_cotacao             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_requisicao          varchar(20) NOT NULL,
    data_cotacao           date NOT NULL REFERENCES dw.dim_calendario (data),
    id_item                char(4) NOT NULL REFERENCES dw.dim_item (id_item),
    id_categoria           char(2) NOT NULL REFERENCES dw.dim_categoria (id_categoria),
    id_fornecedor          char(4) NOT NULL REFERENCES dw.dim_fornecedor (id_fornecedor),
    quantidade             numeric(14, 3) NOT NULL CHECK (quantidade > 0),
    preco_unitario         numeric(12, 2) NOT NULL CHECK (preco_unitario > 0),
    frete                  numeric(12, 2) NOT NULL DEFAULT 0,
    valor_total            numeric(14, 2) NOT NULL CHECK (valor_total >= 0),
    prazo_entrega_dias     smallint NOT NULL,
    prazo_pagamento_dias   smallint NOT NULL,
    selecionada            smallint NOT NULL CHECK (selecionada IN (0, 1)),
    preco_referencia       numeric(12, 2) NOT NULL,
    UNIQUE (id_requisicao, id_fornecedor, id_item)
);
COMMENT ON TABLE dw.fato_cotacao IS 'Propostas recebidas por requisição. Exatamente uma proposta selecionada por requisição.';
CREATE INDEX ix_cotacao_req ON dw.fato_cotacao (id_requisicao);
CREATE INDEX ix_cotacao_data ON dw.fato_cotacao (data_cotacao);
CREATE INDEX ix_cotacao_fornecedor ON dw.fato_cotacao (id_fornecedor);

-- Grão: 1 linha por item/mês (série de preços de mercado)
CREATE TABLE dw.fato_preco (
    mes_ref           char(7) NOT NULL,
    id_item           char(4) NOT NULL REFERENCES dw.dim_item (id_item),
    id_categoria      char(2) NOT NULL REFERENCES dw.dim_categoria (id_categoria),
    preco_medio       numeric(12, 2) NOT NULL CHECK (preco_medio > 0),
    indice_categoria  numeric(10, 4) NOT NULL,
    variacao_mm_pct   numeric(8, 2) NOT NULL,
    PRIMARY KEY (mes_ref, id_item)
);

-- Grão: orçamento mensal por categoria e unidade
CREATE TABLE dw.fato_orcamento (
    mes_ref       char(7) NOT NULL,
    id_categoria  char(2) NOT NULL REFERENCES dw.dim_categoria (id_categoria),
    id_unidade    char(2) NOT NULL REFERENCES dw.dim_unidade (id_unidade),
    orcamento     numeric(14, 2) NOT NULL CHECK (orcamento >= 0),
    forecast      numeric(14, 2) NOT NULL CHECK (forecast >= 0),
    PRIMARY KEY (mes_ref, id_categoria, id_unidade)
);

-- ---------------------------------------------------------------------------
-- CARGA DOS CSVs (exemplo com psql \copy — ajuste o caminho)
-- ---------------------------------------------------------------------------
-- \copy dw.dim_unidade      FROM 'data/dim_unidades.csv'      WITH (FORMAT csv, DELIMITER ';', HEADER true)
-- \copy dw.dim_comprador    FROM 'data/dim_compradores.csv'   WITH (FORMAT csv, DELIMITER ';', HEADER true)
-- \copy dw.dim_categoria    FROM 'data/dim_categorias.csv'    WITH (FORMAT csv, DELIMITER ';', HEADER true)
-- \copy dw.dim_item         FROM 'data/dim_itens.csv'         WITH (FORMAT csv, DELIMITER ';', HEADER true)
-- \copy dw.dim_fornecedor   FROM 'data/dim_fornecedores.csv'  WITH (FORMAT csv, DELIMITER ';', HEADER true)
-- \copy dw.dim_contrato     FROM 'data/dim_contratos.csv'     WITH (FORMAT csv, DELIMITER ';', HEADER true)
-- \copy dw.fato_pedido      FROM 'data/fato_pedidos.csv'      WITH (FORMAT csv, DELIMITER ';', HEADER true)
-- \copy dw.fato_cotacao (id_requisicao,data_cotacao,id_item,id_categoria,id_fornecedor,quantidade,preco_unitario,frete,valor_total,prazo_entrega_dias,prazo_pagamento_dias,selecionada,preco_referencia) FROM 'data/fato_cotacoes.csv' WITH (FORMAT csv, DELIMITER ';', HEADER true)
-- \copy dw.fato_preco       FROM 'data/fato_precos.csv'       WITH (FORMAT csv, DELIMITER ';', HEADER true)
-- \copy dw.fato_orcamento   FROM 'data/fato_orcamento.csv'    WITH (FORMAT csv, DELIMITER ';', HEADER true)

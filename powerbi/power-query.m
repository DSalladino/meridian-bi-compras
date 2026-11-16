// =============================================================================
// Meridian BI · Power Query (M) — extração e tratamento da camada raw
// Uso: Power BI Desktop → Transformar dados → Editor Avançado → colar a consulta.
// Caminho base configurável no parâmetro `CaminhoDados`.
// =============================================================================

// -----------------------------------------------------------------------------
// Parâmetro (Home → Gerenciar Parâmetros)
// -----------------------------------------------------------------------------
// Nome: CaminhoDados | Tipo: Texto | Valor: C:\projetos\meridian-bi-compras\data

// -----------------------------------------------------------------------------
// fnCarregarCSV — leitura padronizada (UTF-8, ';', aspas RFC 4180)
// -----------------------------------------------------------------------------
let
    fnCarregarCSV = (arquivo as text) as table =>
        let
            Fonte = Csv.Document(
                File.Contents(CaminhoDados & "\" & arquivo),
                [Delimiter = ";", Encoding = 65001, QuoteStyle = QuoteStyle.Csv]
            ),
            Cabecalho = Table.PromoteHeaders(Fonte, [PromoteAllScalars = true]),
            SemLinhasVazias = Table.SelectRows(Cabecalho, each not List.IsEmpty(List.RemoveMatchingItems(Record.FieldValues(_), {"", null})))
        in
            SemLinhasVazias
in
    fnCarregarCSV

// -----------------------------------------------------------------------------
// dim_calendario — gerado em M (sem dependência do banco)
// -----------------------------------------------------------------------------
let
    Inicio = #date(2023, 1, 1),
    Fim = #date(2027, 12, 31),
    Dias = List.Dates(Inicio, Duration.Days(Fim - Inicio) + 1, #duration(1, 0, 0, 0)),
    Tabela = Table.FromList(Dias, Splitter.SplitByNothing(), {"data"}),
    Tipos = Table.TransformColumnTypes(Tabela, {{"data", type date}}),
    Colunas = Table.AddColumn(Tipos, "ano", each Date.Year([data]), Int64.Type),
    Colunas2 = Table.AddColumn(Colunas, "mes", each Date.Month([data]), Int64.Type),
    Colunas3 = Table.AddColumn(Colunas2, "ano_mes", each Date.ToText([data], "yyyy-MM"), type text),
    Colunas4 = Table.AddColumn(Colunas3, "trimestre", each Date.QuarterOfYear([data]), Int64.Type),
    Colunas5 = Table.AddColumn(Colunas4, "dia_semana", each Date.DayOfWeek([data], Day.Monday) + 1, Int64.Type),
    Colunas6 = Table.AddColumn(Colunas5, "nome_mes", each Date.ToText([data], "MMM", "pt-BR"), type text),
    Colunas7 = Table.AddColumn(Colunas6, "eh_dia_util", each Date.DayOfWeek([data], Day.Monday) < 5, type logical)
in
    Colunas7

// -----------------------------------------------------------------------------
// fato_pedido — tipagem, limpeza, deduplicação e colunas derivadas
// -----------------------------------------------------------------------------
let
    Bruto = fnCarregarCSV("fato_pedidos.csv"),
    Tipos = Table.TransformColumnTypes(Bruto, {
        {"data_emissao", type date}, {"data_entrega_prevista", type date}, {"data_entrega_real", type date},
        {"quantidade", type number}, {"valor_unitario", type number}, {"frete", type number},
        {"valor_total", type number}, {"preco_referencia", type number}, {"saving_valor", type number},
        {"atraso_dias", Int64.Type}, {"qtd_recebida", type number}, {"qtd_defeito", type number},
        {"otif", Int64.Type}, {"nota_qualidade", type number}, {"tem_contrato", type logical}
    }),
    StatusPadrao = Table.TransformColumns(Tipos, {
        {"status", each Text.Proper(Text.Trim(Text.Replace(_, "  ", " "))), type text},
        {"modalidade", each Text.Trim(_), type text}
    }),
    SemDuplicatas = Table.Distinct(StatusPadrao, {"id_pedido"}),
    SemCancelados = Table.SelectRows(SemDuplicatas, each [status] <> null),
    Deriva = Table.AddColumn(SemCancelados, "mes_ref_calc", each Date.ToText([data_emissao], "yyyy-MM"), type text),
    Consistente = Table.AddColumn(Deriva, "check_total", each
        Number.Abs([valor_total] - ([quantidade] * [valor_unitario] + [frete])) < 0.05, type logical),
    // Economia pode ser negativa quando o preço negociado supera a referência.
    // Não aplicar Number.Max(0, ...): isso divergia do SQL, do DAX e do painel.
    Saving = Table.AddColumn(Consistente, "saving_calc",
        each ([preco_referencia] - [valor_unitario]) * [quantidade], type number),
    // mes_ref é derivado da data de emissão: descarta o valor do CSV para
    // garantir a mesma competência usada pelo painel e pelas views SQL.
    SemMesOriginal = Table.RemoveColumns(Saving, {"mes_ref"}),
    Renomeia = Table.RenameColumns(SemMesOriginal, {{"mes_ref_calc", "mes_ref"}})
in
    Renomeia

// -----------------------------------------------------------------------------
// fato_cotacao — uma proposta por fornecedor/requisição
// -----------------------------------------------------------------------------
let
    Bruto = fnCarregarCSV("fato_cotacoes.csv"),
    Tipos = Table.TransformColumnTypes(Bruto, {
        {"data_cotacao", type date}, {"quantidade", type number}, {"preco_unitario", type number},
        {"frete", type number}, {"valor_total", type number}, {"selecionada", Int64.Type},
        {"preco_referencia", type number}, {"prazo_entrega_dias", Int64.Type}, {"prazo_pagamento_dias", Int64.Type}
    }),
    Dedup = Table.Distinct(Tipos, {"id_requisicao", "id_fornecedor", "id_item"}),
    Desvio = Table.AddColumn(Dedup, "desvio_pct",
        each if [preco_referencia] > 0 then [preco_unitario] / [preco_referencia] - 1 else null, type number),
    Economia = Table.AddColumn(Desvio, "saving_potencial",
        each ([preco_referencia] - [preco_unitario]) * [quantidade], type number)
in
    Economia

// -----------------------------------------------------------------------------
// dim_fornecedor — normalização de cadastro e classificação de risco
// -----------------------------------------------------------------------------
let
    Bruto = fnCarregarCSV("dim_fornecedores.csv"),
    Tipos = Table.TransformColumnTypes(Bruto, {
        {"data_homologacao", type date}, {"prazo_pagamento_dias", Int64.Type},
        {"rating_cadastral", Int64.Type}, {"lead_time_medio_dias", Int64.Type}
    }),
    Nomes = Table.TransformColumns(Tipos, {
        {"razao_social", each Text.Proper(Text.Trim(Text.Replace(_, "  ", " "))), type text},
        {"uf", each Text.Upper(Text.Trim(_)), type text}
    }),
    Risco = Table.AddColumn(Nomes, "risco_calc", each
        if [rating_cadastral] >= 85 then "Baixo"
        else if [rating_cadastral] >= 70 then "Médio"
        else "Alto", type text)
in
    Risco

// -----------------------------------------------------------------------------
// fato_orcamento e fato_preco — chaves de tempo como texto (YYYY-MM)
// -----------------------------------------------------------------------------
// Reaproveite fnCarregarCSV e aplique:
//   Table.TransformColumnTypes(..., {{"orcamento", type number}, {"forecast", type number}})
//   Table.TransformColumnTypes(..., {{"preco_medio", type number}, {"indice_categoria", type number}})
//
// Validação sugerida (Power Query):
//   Table.RowCount(fato_pedido) >= 3000
//   Table.IsDistinct(fato_pedido, {"id_pedido"}) = true
//   Table.FindText(fato_pedido, "null") = false

// -----------------------------------------------------------------------------
// INTEGRAÇÃO REAL POSTGRESQL → POWER BI
// Parâmetros (Home → Gerenciar Parâmetros):
//   ServidorPostgres = localhost:5432
//   BancoPostgres    = meridian
//   EsquemaPostgres  = dw
// Use uma conta somente leitura; nunca embuta senha no arquivo. Em produção,
// configure o gateway e credenciais no Power BI Service.
// -----------------------------------------------------------------------------
// Consulta: fato_pedido_postgres
let
    Fonte = PostgreSQL.Database(ServidorPostgres, BancoPostgres),
    Esquema = Fonte{[Schema = EsquemaPostgres]}[Data],
    Pedidos = Esquema{[Item = "fato_pedido", Kind = "Table"]}[Data],
    Tipos = Table.TransformColumnTypes(Pedidos, {
        {"data_emissao", type date}, {"data_entrega_prevista", type date}, {"data_entrega_real", type date},
        {"tem_contrato", type logical}
    })
in
    Tipos

// Consulta: dim_contrato_postgres
let
    Fonte = PostgreSQL.Database(ServidorPostgres, BancoPostgres),
    Esquema = Fonte{[Schema = EsquemaPostgres]}[Data],
    Contratos = Esquema{[Item = "dim_contrato", Kind = "Table"]}[Data],
    Tipos = Table.TransformColumnTypes(Contratos, {
        {"data_inicio", type date}, {"data_fim", type date},
        {"valor_anual", type number}, {"reajuste_pct", type number}
    })
in
    Tipos

// Consulta: vw_kpi_geral_postgres — reconciliação oficial do dashboard
let
    Fonte = PostgreSQL.Database(ServidorPostgres, BancoPostgres),
    Esquema = Fonte{[Schema = EsquemaPostgres]}[Data],
    Kpis = Esquema{[Item = "vw_kpi_geral", Kind = "View"]}[Data]
in
    Kpis

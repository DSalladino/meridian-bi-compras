# Power BI — modelo, tema e páginas

O `.pbix` é binário e não é versionado. Este guia reconstrói o relatório a partir do
repositório em ~20 minutos.

## 1. Conectar o modelo

Duas opções:

**a) Direto no PostgreSQL**
1. `Obter dados → PostgreSQL` e informe `localhost:5432` / banco `meridian`.
2. Importe as tabelas `dw.*` e a view `vw_kpi_geral`.
3. Modo **Import** (recomendado) para 17 mil linhas; DirectQuery se a atualização precisar
   ser em tempo real.

**b) A partir dos CSVs**
1. `Obter dados → Texto/CSV`, separador `;`, codificação UTF-8.
2. Renomeie as consultas com os nomes do modelo (`dim_fornecedor`, `fato_pedido`, ...).

## 2. Tratamento no Power Query

O arquivo [`power-query.m`](power-query.m) traz consultas prontas:

- `fnCarregarCSV` — leitura UTF-8, separador `;`, aspas RFC 4180;
- `dim_calendario` — calendário 2023–2027 gerado em M;
- `fato_pedido` — tipagem, deduplicação por `id_pedido`, `check_total` e saving recalculado;
- `fato_cotacao` — deduplicação e `desvio_pct`/`saving_potencial`;
- `dim_fornecedor` — normalização de nome/UF e `risco_calc`.

Crie o parâmetro `CaminhoDados` apontando para a pasta `data` e cole cada bloco em
**Editor Avançado**. Em produção, troque `File.Contents` por `PostgreSQL.Database`.

## 3. Relacionamentos

Crie as relações conforme `docs/02-modelo-dados.md`. Pontos de atenção:

- `dim_calendario` precisa ser marcada como **tabela de datas** (`data`).
- A relação de `fato_cotacao` com o calendário é **inativa**; ative com `USERELATIONSHIP`
  nas medidas de cotação.
- `fato_preco` e `fato_orcamento` relacionam por `ano_mes` (texto), não por data.

## 4. Medidas

Cole o conteúdo de [`../dax/medidas.dax`](../dax/medidas.dax) em uma tabela de medidas
(`_Medidas`). As metas estão como medidas (`Meta Economia`, `OTIF Meta`) para permitir
ajuste sem editar fórmulas.

## 5. Tema

`Exibição → Temas → Procurar temas` e selecione `tema-pastel.json`.

O tema define:

- 12 cores de dados em pastel, começando por menta `#7FC8A9`, lilás `#A99BD6` e blush `#E89B93`;
- fundo `#F7F5F0`, cartões brancos com raio 16 e sombra suave;
- tipografia Segoe UI, rótulos em `#837D90` e valores em `#2F2B3A`;
- eixos com grade `#F1EDF6` e legendas no topo.

## 6. Páginas sugeridas

| Página | Visuais |
| --- | --- |
| **Executivo** | 6 cartões KPI · linha realizado vs. orçamento · rosca por categoria · top 10 fornecedores · colunas de economia mensal · matriz categoria × mês (formatação condicional) |
| **Cotações** | cartões de requisições/economia/spread · barras de economia por categoria · dispersão preço vencedor × referência com linha de 45° · tabela de propostas |
| **Fornecedores** | matriz spend × OTIF (bolha = pedidos, cor = risco) · radar de 4 pilares · ranking por score · mapa por UF · tabela detalhada |
| **Prazos** | OTIF mensal com linha de meta · gauge de aderência · barras de atraso por categoria · histograma de atrasos · tabela de pedidos em aberto |
| **Preços** | índice por categoria · variação 12m (barras divergentes) · série do item · monitor com impacto financeiro |

### Dicas de construção

- **Matriz categoria × mês:** linhas = categoria, colunas = `dim_calendario[ano_mes]`,
  valores = `[Spend]`; formatação condicional de plano de fundo com escala menta → lilás.
- **Dispersão:** eixo X `[Spend]`, eixo Y `[OTIF]`, tamanho `[Pedidos]`, detalhes
  `dim_fornecedor[razao_social]`; adicione linhas de média com o visual de análise.
- **Gauge de OTIF:** valor `[OTIF]`, meta `[OTIF Meta]`, cor via `[Cor Semáforo OTIF]`
  (formatação condicional por campo).
- **Cartões KPI:** use `[KPI Dinâmico]` com uma tabela `Parâmetros` de indicadores para
  alternar a métrica do cartão.
- **Tooltip personalizada:** arraste `[Economia]`, `[OTIF]` e `[Cotações por Requisição]`
  para a página de tooltip.

## 7. RLS sugerida

```dax
// Papel: Unidade
[unidade] = LOOKUPVALUE(
    dim_unidade[unidade],
    dim_unidade[id_unidade], USERPRINCIPALNAME()
)
```

Em um cenário real, mapeie o e-mail do usuário para `id_unidade` em uma tabela de segurança.

## 8. Atualização

- Gateway padrão para PostgreSQL on-premises.
- Atualização agendada 05:30, após o ETL (05:00).
- Notificação de falha para o e-mail da equipe de Suprimentos.

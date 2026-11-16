# Checklist de QA

Roteiro rápido de validação antes de publicar uma alteração.

## Dados e números

- [ ] `npm run data` roda sem erro e mantém as contagens (3.120 pedidos, 11.416 propostas).
- [ ] `npm test` passa (KPI, paridade, upload e XLSX).
- [ ] `python etl/pipeline_etl.py --validate-only` retorna 0 erros.
- [ ] Spend total ≈ R$ 78,9 mi; economia ≈ R$ 6,65 mi (~8,4%); OTIF ≈ 78,6%.
- [ ] `vw_kpi_geral` concorda com os cartões da Visão executiva (tolerância de arredondamento).
- [ ] `npm run test:sql` retorna zero divergências (quando houver PostgreSQL).
- [ ] Carteira contratual: 11 vigentes, 8 a vencer em 90 dias e 18 vencidos (referência out/2026).
- [ ] Nenhum item/fornecedor aparece como `undefined` ou `NaN` nas tabelas.

## Navegação e filtros

- [ ] As 7 páginas abrem sem erro no console.
- [ ] Trocar período recalcula KPIs e deltas (comparação com período anterior).
- [ ] Filtros combinados (unidade + categoria + comprador) não geram estado vazio inesperado.
- [ ] "Limpar filtros" restaura período de 12 meses e todos os selects em "Todos".
- [ ] Período personalizado exibe os campos de data e respeita o intervalo.
- [ ] Deep link (`#fornecedores`, `#precos`) abre a página correta após recarregar.

## Interações

- [ ] Selecionar fornecedor no scorecard atualiza o radar e os indicadores; score nulo mostra “sem histórico”.
- [ ] Selecionar item em Preços atualiza a série temporal.
- [ ] Previsão de spend renderiza 3 meses futuros e o gap contra o orçamento de referência.
- [ ] Simulador de renegociação recalcula economia incremental ao alterar desconto/cobertura/volume.
- [ ] Contratos & riscos exibe alerta crítico para vencido com pedido ativo e alerta de reajuste > 5%.
- [ ] Tooltips dos gráficos exibem valores formatados em pt-BR.
- [ ] Nenhum gráfico estoura o cartão em 390 px, 768 px, 1280 px e 1600 px.

## Exportações

- [ ] Excel baixa `.xlsx` e abre com 5 abas, cabeçalho congelado e valores numéricos.
- [ ] PDF gera 2 páginas A4 com KPIs, gráficos e tabelas legíveis.
- [ ] CSV de pedidos/cotações respeita os filtros ativos.
- [ ] Nome dos arquivos inclui timestamp (`meridian_compras_AAAAMMDD-HHMM.xlsx`).

## Upload

- [ ] Modelo CSV baixado contém as 19 colunas e 2 linhas de exemplo.
- [ ] Arquivo válido passa na validação e, ao aplicar, atualiza os KPIs.
- [ ] Mesmo `id_pedido` atualiza o registro em vez de duplicar.
- [ ] Data inválida (31/02), item inexistente e total inconsistente geram erro/aviso claro.
- [ ] "Remover importações" volta ao estado original e limpa o `localStorage`.

## Acessibilidade e acabamento

- [ ] Foco visível em botões, selects e navegação (tab).
- [ ] Contraste de texto ≥ 4,5:1 nos cartões.
- [ ] Gráficos têm título e leitura textual (eixo, legenda, tooltip).
- [ ] Layout de impressão não corta tabelas nem sobrepõe gráficos.

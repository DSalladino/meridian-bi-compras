# Qualidade de dados e governança

## Dimensões monitoradas

| Dimensão | Exemplos de verificação | Severidade |
| --- | --- | --- |
| Completude | datas de emissão, preços, chaves estrangeiras nulas | erro |
| Unicidade | PKs de dimensões e fatos, propostas duplicadas | erro |
| Integridade referencial | fornecedor/item/categoria/unidade existentes | erro |
| Domínio | status permitidos, OTIF binário, criticidade | erro |
| Consistência | entrega ≥ emissão, total ≈ quantidade × preço, saving ≥ 0 | erro / aviso |
| Acurácia de regra | OTIF coerente com prazo/completude/qualidade | aviso |
| Atualidade | competência mais recente ≥ mês corrente | aviso |
| Volume | mínimo de pedidos e de propostas | aviso |
| Cobertura | todo mês/categoria/unidade com pedido tem orçamento | aviso |

O pipeline (`etl/pipeline_etl.py`) grava o resultado em `etl/out/quality_report.json` com
timestamp UTC, contagem por tabela e lista de checagens. **Erro bloqueia a carga; aviso é
registrado e segue**, porque bloqueios por regra secundária tendem a parar a operação sem
necessidade.

## Regras de negócio implementadas

1. `saving = (referência − negociado) × quantidade`; negativo indica sobrepreço e é
   reportado separadamente (11% dos pedidos na base atual).
2. `otif = 1` apenas se `status = 'Entregue'`, `atraso_dias = 0`,
   `qtd_recebida >= quantidade` e `qtd_defeito = 0`. No PostgreSQL a coluna é
   `GENERATED ALWAYS`; no DAX existe `OTIF por Flag`/`Divergência OTIF` para auditoria.
3. `qtd_recebida <= quantidade × 1,05` (tolerância de overdelivery de 5%).
4. `qtd_defeito <= qtd_recebida`.
5. `data_entrega_real >= data_emissao` quando existir.
6. Exatamente **uma** proposta selecionada por requisição.
7. Pedido cancelado não entra em spend, mas permanece na base (taxa de cancelamento).
8. `valor_total ≈ quantidade × valor_unitario + frete` — divergência > 3% gera aviso no
   upload; no ETL o frete é reconstruído a partir de `valor_total` (fonte da verdade).

## Testes

| Tipo | O que cobre | Como executar |
| --- | --- | --- |
| Reconciliação | carga × CSV (contagens, somatórios, OTIF, savings) | `python etl/pipeline_etl.py --validate-only` |
| OTIF | flag × regra canônica (prazo, completude e qualidade) | `SELECT count(*) FROM dw.vw_otif_auditoria;` deve retornar 0 |
| Rollback | staging + swap na mesma transação; `TRUNCATE` sem CASCADE | revisar log do pipeline e `pg_stat_activity` |
| Estrutural | XLSX gerado é um ZIP válido, com CRCs corretos e XML esperado | inspeção do arquivo baixado |
| Funcional (manual) | filtros, navegação, upload, exportações | checklist em `docs/checklist-qa.md`* |
| Regressão de números | KPIs do painel × views SQL | comparação `vw_kpi_geral` |
| Responsividade | 390 px, 768 px, 1280 px, 1600 px | DevTools |

\* checklist curto mantido junto do README de QA interno.

## Governança do indicador

Cada KPI tem **dono**, **definição versionada** e **regra de aceite**:

| KPI | Dono | Fonte | Regra de aceite |
| --- | --- | --- | --- |
| Spend | Controladoria de Suprimentos | `fato_pedido` | reconcilia com ERP no fechamento |
| Savings | Gestão de Compras | `fato_pedido` + catálogo | baseline revisado trimestralmente |
| OTIF | Logística / Suprimentos | `fato_pedido` | SLA contratual |
| Orçamento | FP&A | `fato_orcamento` | aprovação mensal |
| Score de fornecedor | Compliance / Compras | modelo interno | revisão semestral dos pesos |

Mudança de definição exige: nova versão do indicador, nota no changelog, reprocessamento do
histórico e comunicação aos consumidores. Nunca se altera a fórmula “no lugar”.

## Segurança e LGPD

- Dataset 100% sintético; nenhum dado pessoal real.
- Em produção, o cadastro de fornecedores conteria CNPJ e contatos de representantes:
  classificação **interna**, mascaramento de e-mail/telefone no Power BI e RLS por unidade.
- Credenciais apenas em variável de ambiente (`.env` fora do versionamento).
- Exportações carregam os filtros aplicados no rodapé do relatório, garantindo rastreabilidade
  do recorte apresentado.

## Versionamento e reprodutibilidade

- `package.json` fixa a versão do Node mínima; sem dependências de runtime no painel.
- Dataset gerado com seed fixa: mesma entrada → mesmo resultado.
- `etl/requirements.txt` fixa faixas mínimas de pandas e psycopg2.
- Estrutura de branch: `main` estável, `feat/*` para evolução, PR com print do antes/depois
  quando a mudança é visual.

## Monitoramento recomendado (produção)

1. Falha de carga → alerta no canal de Suprimentos com o `quality_report.json` anexado.
2. Variação de spend > 15% vs. mês anterior → investigação de lançamento atípico.
3. OTIF < 80% por dois meses consecutivos → revisão de fornecedor.
4. Cotações por requisição < 2,5 → auditoria de processo.
5. Reajuste acima do índice contratual → bloqueio de pagamento até aprovação.

## Limitações conhecidas

- Não há integração com ERP real: a camada raw é CSV.
- O upload do painel é local (não persiste em banco).
- O calendário não marca feriados móveis (apenas fim de semana).
- Não há SCD tipo 2 nas dimensões; o histórico é preservado no fato.
- A carga é full refresh — adequada ao volume atual, não a dezenas de milhões de linhas.

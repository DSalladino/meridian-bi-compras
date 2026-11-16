# PostgreSQL → Power BI (integração real)

Este roteiro cobre a integração ponta a ponta: banco local, carga do ETL, conexão do Power
BI Desktop, modelo, atualização agendada e o caminho para disponibilizar o `.pbix`
demonstrativo sem versionar binário no Git.

## 1. Subir o PostgreSQL

```bash
docker compose up -d postgres
```

O container `postgres:16` expõe `localhost:5432`, banco `meridian`, usuário `postgres` e
aplica `sql/01_ddl.sql` na primeira inicialização. O volume `meridian_pgdata` preserva os
dados. Para recriar do zero: `docker compose down -v`.

## 2. Carregar a camada gold

```bash
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/meridian
pip install -r etl/requirements.txt

python etl/pipeline_etl.py --dsn "$DATABASE_URL" --mode full
psql "$DATABASE_URL" -f sql/02_views_kpi.sql
psql "$DATABASE_URL" -f sql/04_governanca.sql
```

O `--mode full` é o padrão. Para rotina incremental:

```bash
python etl/pipeline_etl.py --dsn "$DATABASE_URL" --mode incremental --since 2026-09-01
```

O log fica em `dw.etl_run_log`; a última execução bem-sucedida aparece em
`dw.vw_etl_ultima_execucao`.

## 3. Conectar o Power BI Desktop

1. **Obter dados → PostgreSQL**.
2. Servidor `localhost:5432`, banco `meridian`.
3. Selecione o esquema `dw` e importe as tabelas e views.
4. Modo **Import** para ~17 mil linhas; **DirectQuery** se precisar de tempo real.

Consultas prontas em [`../powerbi/power-query.m`](../powerbi/power-query.m):

- `fato_pedido_postgres`
- `dim_contrato_postgres`
- `vw_kpi_geral_postgres`

Parâmetros: `ServidorPostgres`, `BancoPostgres`, `EsquemaPostgres`. Nunca embuta senha no
arquivo; use credenciais do Power BI e, em produção, um usuário somente leitura.

## 4. Modelo e relacionamentos

Siga [`02-modelo-dados.md`](02-modelo-dados.md). Pontos de atenção:

- Marque `dim_calendario[data]` como **tabela de datas**.
- A relação de `fato_cotacao` com o calendário é inativa; use `USERELATIONSHIP`.
- `fato_preco` e `fato_orcamento` se relacionam por `ano_mes` (texto).
- `dim_contrato` se relaciona por fornecedor e categoria; o realizado contratual no DAX usa
  a mesma regra do painel (fornecedor + categoria + vigência).
- Cole as medidas de [`../dax/medidas.dax`](../dax/medidas.dax) em `_Medidas`.

## 5. Validação de paridade

Antes de publicar, rode:

```bash
npm run test:sql
```

O script compara `spend`, `saving`, `OTIF`, entregas, cobertura contratual e toda a carteira
contratual (`vigentes`, `a vencer`, `vencidos`, valor, realizado, saldo e exposição). Também
exige zero ocorrências em `dw.vw_integridade_checklist` e `dw.vw_otif_auditoria`.

## 6. Publicação e atualização agendada

1. **Publicar → Meu workspace** no Power BI Desktop.
2. Instale o **gateway de dados on-premises** se o PostgreSQL estiver fora do Azure.
3. Em **Configurações do conjunto de dados → Credenciais da fonte**, use o usuário de leitura.
4. **Atualização agendada**: sugira 05:30, após o ETL das 05:00.
5. Configure alerta de falha para o e-mail de Suprimentos.
6. Aplique RLS por unidade se o modelo for compartilhado (ver `powerbi/README.md`).

## 7. PBIX demonstrativo

O `.pbix` é um binário proprietário e não deve entrar no histórico do Git. O fluxo
recomendado:

1. Abra o modelo no Power BI Desktop com a conexão PostgreSQL acima.
2. **Arquivo → Salvar como** `meridian-bi-compras-demo.pbix`.
3. Valide os cartões contra `vw_kpi_geral` e as capturas de `docs/capturas/`.
4. Publique o arquivo como **asset de release** no GitHub:

```bash
gh release create demo-1.0 meridian-bi-compras-demo.pbix \
  --title "Demonstração Power BI" \
  --notes "PBIX conectado ao schema dw do Meridian BI"
```

5. No README, aponte para a release, não para um blob no repositório.

Se o time quiser versionar o modelo, o formato texto é o **PBIP** (Power BI Project), que
pode ser revisado em PR e aberto no Desktop; o `.pbix` continua sendo o artefato de
distribuição. O repositório já entrega os arquivos-fonte necessários (DDL, M, DAX, tema).

## 8. Segurança

- Crie um usuário `leitor_bi` com `GRANT USAGE ON SCHEMA dw` e `GRANT SELECT` nas tabelas/views.
- Não use o superusuário `postgres` no Power BI Service.
- Restrinja a porta 5432 ao host/gateway; em nuvem, use TLS e firewall.
- Dados do dataset são sintéticos; em produção, classifique o cadastro de fornecedores como
  interno e mascare contatos/LGPD.

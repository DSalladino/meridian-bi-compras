# Implantação em uma empresa real

Este guia transforma a demonstração em uma instalação operacional. A regra é simples:
**cada empresa é uma instalação** (um banco `dw` e um volume de dados). Não há mistura de
empresas no mesmo diretório; multi-tenant por linha é um passo posterior.

> Tempo estimado do primeiro piloto: **1 a 3 dias** (mapeamento + homologação dos números).
> O que costuma dominar o cronograma é a extração do ERP, não o painel.

---

## 0. Checklist de decisão

| Tema | Decisão necessária |
| --- | --- |
| Fonte | ERP (SAP MM, Oracle Purchasing, TOTVS, Senior, Benner…), planilhas ou ambos |
| Grão | pedido de compra, item do pedido ou nota fiscal? O modelo espera **1 linha por item de pedido** |
| Baseline de saving | preço de referência auditável (catálogo, contrato ou média histórica) |
| Moeda e impostos | valores brutos ou líquidos? O `valor_total` deve ter a mesma regra em toda a série |
| Orçamento | vem do ERP/controladoria? sem ele, os KPIs de aderência ficam sem denominador |
| Contratos | há exportação com fornecedor, categoria, vigência e valor anual? |
| Acesso | quem administra, quem importa, quem só lê? Há restrição por unidade/categoria? |
| Retenção/LGPD | prazo de retenção de pedidos, nomes de compradores e logs de auditoria |

---

## 1. Configurar o perfil da empresa

```bash
node scripts/importar_erp.mjs --novo      # cria config/empresa.json
```

Edite `config/empresa.json`:

- `empresa`: nome, marca, subtítulo, moeda e locale exibidos no painel e no PDF.
- `metas`: frações (`0.9` = 90%) de OTIF, saving, cobertura contratual, HHI, prazo de
  contrato e reajuste. O painel, o relatório e a carteira de contratos passam a usar
  esses valores.
- `limites`: linhas por upload e tamanho máximo do arquivo.
- `origem`: como o ERP exporta (`;`, `,` ou tab; UTF-8 ou Windows-1252; decimal pt-BR ou
  en-US) e o **mapeamento de colunas** de cada tabela.
- `rotulos` (opcional): nomes legíveis para códigos, quando a origem só traz IDs.

Formato mínimo de `origem`:

```json
{
  "origem": {
    "delimitador": ";",
    "codificacao": "windows-1252",
    "decimal": "pt-BR",
    "formatoData": "dd/mm/aaaa",
    "tabelas": {
      "fato_pedidos": {
        "arquivo": "pedidos.csv",
        "colunas": { "id_pedido": "Nº do pedido", "data_emissao": "Dt. emissão" },
        "valoresFixos": { "modalidade": "ERP" },
        "traducoes": { "status": { "ENTREGUE": "Entregue", "CANCELADO": "Cancelado" } }
      }
    }
  }
}
```

### Colunas canônicas

| Tabela | Obrigatórias | Derivadas pelo importador |
| --- | --- | --- |
| `fato_pedidos` | pedido, emissão, fornecedor, item, categoria, unidade, quantidade, valor unitário, total, status | `mes_ref`, `saving_valor`, `atraso_dias`, `otif`, `frete` (se ausente) |
| `fato_cotacoes` | requisição, data, item, fornecedor, quantidade, preço, vencedora | `id_categoria`, `valor_total`, referência (do item) |
| `dim_fornecedores` | código, razão social, categoria | UF, porte, status, rating, risco, prazos |
| `dim_itens` | código, descrição, categoria, preço de referência | unidade, criticidade |
| `dim_categorias` | código, nome | grupo, criticidade, natureza, peso, drift, lead time |
| `dim_unidades` | código, nome | cidade, UF, tipo |
| `dim_compradores` | código, nome | unidade, categoria responsável |
| `dim_contratos` | número, fornecedor, categoria, início, fim | valor, reajuste, índice, status |
| `fato_orcamento` | competência, categoria, unidade, orçamento | forecast |
| `fato_precos` | competência, item, preço médio | índice e variação mensal |

Se um cadastro não for enviado, o importador **cria a dimensão a partir do histórico** e
registra um aviso. Isso permite começar só com a exportação de pedidos, mas o resultado
analítico melhora quando o cadastro é enviado.

---

## 2. Importar e homologar

```bash
node scripts/importar_erp.mjs --origem ./erp --saida data_empresa
```

O comando:

1. lê os arquivos com o delimitador/codificação configurados;
2. traduz status, números e datas;
3. deriva saving, OTIF, atraso, série de preços e dimensões ausentes;
4. valida PK, FK, domínios, saving e OTIF;
5. grava CSVs canônicos, `config.json` e `relatorio_importacao.json`;
6. sai com código 1 se houver erro bloqueante.

Para o painel web, o diretório lido é `data/`. Depois de validar em `data_empresa`, publique
com `--saida data --forcar` (o `--forcar` protege contra sobrescrever o demo por acidente e
não apaga `data/imported`, que deve ser limpo à parte em uma troca de empresa). No Docker, o
volume `meridian_data` é o equivalente: copie o conteúdo com
`docker cp data_empresa/. meridian-bi:/app/data/` e reinicie o serviço.

**Não avance com erros.** Ajuste o mapeamento ou o cadastro até o relatório ficar limpo.
Avisos comuns e o que fazer:

| Aviso | Ação |
| --- | --- |
| dimensão criada automaticamente | completar cidade/UF, rating, categoria principal no cadastro |
| `fato_cotacoes` vazio | sem funil de cotações; savings por pedido continua funcionando |
| `fato_orcamento` vazio | aderência ao orçamento fica sem denominador; importar orçamento |
| série de preços derivada | é uma aproximação do preço praticado; para inflação oficial, importe `fato_precos` |
| requisição sem exatamente uma vencedora | corrigir a flag “vencedora” na exportação |
| pedidos com saving negativo | sobrepreço real ou baseline incorreto — validar com Suprimentos |

### Conferência de números (obrigatória)

Antes de publicar, concilie pelo menos:

- spend total do período com o relatório do ERP;
- número de pedidos e de fornecedores ativos;
- OTIF de um mês fechado;
- savings do mês com a área de Suprimentos;
- contratos vigentes e valores anuais.

Divergência de spend > 1% ou de OTIF > 2 p.p. deve ser explicada antes do go-live.

---

## 3. Carregar na camada analítica (PostgreSQL + Power BI)

```bash
docker compose up -d postgres
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/meridian

psql "$DATABASE_URL" -f sql/01_ddl.sql
python etl/pipeline_etl.py --data-dir data_empresa --dsn "$DATABASE_URL" --mode full
psql "$DATABASE_URL" -f sql/02_views_kpi.sql
psql "$DATABASE_URL" -f sql/04_governanca.sql
```

O DDL já aceita códigos longos (até 40 caracteres), calendário 2015–2035 e tabelas
opcionais vazias (contratos, cotações, preços, orçamento). Se a empresa tiver histórico
fora da janela do calendário, ajuste o `generate_series` em `sql/01_ddl.sql`.

Para atualização recorrente, use `--mode incremental --since AAAA-MM-DD` no agendador
(cron, Airflow, Task Scheduler) e monitore `dw.etl_run_log` e
`dw.vw_integridade_checklist`.

---

## 4. Subir o painel com login e auditoria

### Opção A — processo Node + HTTPS no proxy

```bash
cp .env.example .env                 # ajuste segredo e bootstrap
node scripts/usuarios.mjs criar --usuario admin --nome "Admin" --papel admin
MERIDIAN_SESSION_SECRET="$(openssl rand -base64 48)" npm run start:prod
```

- O painel fica em `http://localhost:4173` e redireciona para `/login.html`.
- Usuários ficam em `config/usuarios.json` (modo 600, nunca versionar).
- A senha é scrypt com salt; a sessão é um cookie `HttpOnly` assinado por HMAC.
- Importações passam a ser persistidas em `data/imported/pedidos.csv` com backup em
  `data/backups/` e registro em `logs/auditoria.jsonl`.
- Coloque atrás de Nginx/Caddy com TLS e defina `MERIDIAN_SECURE_COOKIE=1`.

### Opção B — Docker Compose

```bash
cat > .env <<EOF
MERIDIAN_SESSION_SECRET=$(openssl rand -base64 48)
MERIDIAN_BOOTSTRAP_ADMIN=$(openssl rand -base64 12)
MERIDIAN_SECURE_COOKIE=0
EOF
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f app
```

O primeiro boot cria o usuário `admin` com a senha de `MERIDIAN_BOOTSTRAP_ADMIN`; entre,
troque a senha e remova a variável do `.env`. Volumes: `meridian_data`, `meridian_config`,
`meridian_logs`.

### Papéis

| Papel | Consulta | Exporta | Importa | Administra usuários/auditoria |
| --- | :-: | :-: | :-: | :-: |
| `admin` | ✓ | ✓ | ✓ | ✓ |
| `analista` | ✓ | ✓ | ✓ | — |
| `comprador` | ✓ | ✓ | ✓ | — |
| `leitor` | ✓ | ✓ | — | — |

Escopo opcional por unidade/categoria/fornecedor filtra os CSVs de fatos servidos ao
usuário (inclusive cotações herdadas da requisição). Ele **não** substitui segurança de
rede em exportações já baixadas.

```bash
node scripts/usuarios.mjs criar --usuario ana --nome "Ana" --papel analista
node scripts/usuarios.mjs escopo --usuario ana --unidades U1,U2 --categorias K1
node scripts/usuarios.mjs listar
```

---

### Administração no produto

Usuários com papel `admin` veem o item **Administração** no menu. A tela permite:

- criar usuário local (senha digitada ou gerada e exibida uma única vez);
- alterar nome, papel, status e escopo por unidade/categoria/fornecedor;
- redefinir senha (invalida sessões antigas) e desativar usuário;
- consultar os últimos eventos de auditoria, incluindo exportações.

O último administrador ativo não pode ser removido, rebaixado ou desativado — a API
responde `409` e a ação fica registrada.

### SSO com OpenID Connect

O login local continua disponível como contingência. Para habilitar o botão **Entrar com
SSO**, configure o provedor e o redirect URI:

```bash
MERIDIAN_PUBLIC_URL=https://bi.suaempresa.com
MERIDIAN_OIDC_ISSUER=https://login.microsoftonline.com/<tenant>/v2.0
MERIDIAN_OIDC_CLIENT_ID=<application-id>
MERIDIAN_OIDC_CLIENT_SECRET=<secret>          # omita em client público com PKCE
MERIDIAN_OIDC_REDIRECT_URI=https://bi.suaempresa.com/auth/oidc/callback
MERIDIAN_OIDC_ROLE_CLAIM=roles
MERIDIAN_OIDC_ROLE_MAP='{"Meridian-Admins":"admin","Meridian-Analysts":"analista"}'
MERIDIAN_OIDC_ADMIN_ROLES=meridian-admin
MERIDIAN_OIDC_DEFAULT_ROLE=leitor
MERIDIAN_OIDC_AUTO_PROVISION=1
```

Exemplos de provedor:

| Provedor | Issuer | Observação |
| --- | --- | --- |
| Azure AD / Entra ID | `https://login.microsoftonline.com/<tenant>/v2.0` | use App Roles e `MERIDIAN_OIDC_ROLE_CLAIM=roles` |
| Google Workspace | `https://accounts.google.com` | papéis por `MERIDIAN_OIDC_ADMINS` ou grupo via claim customizada |
| Keycloak | `https://<host>/realms/<realm>` | client confidencial; `realm_access.roles` é lido como fallback |
| Okta / Authentik | issuer do app | mapeie grupos com `MERIDIAN_OIDC_ROLE_MAP` |

O fluxo usa **Authorization Code + PKCE (S256)**, valida assinatura do `id_token`
(RS256/384/512 ou ES256), `iss`, `aud`, `exp` e `nonce`. O primeiro login provisiona o
usuário local; logins seguintes atualizam nome/e-mail e aplicam o papel somente quando a
claim é explícita (claim ausente não rebaixa um admin existente).

Com `MERIDIAN_OIDC_AUTO_PROVISION=0`, o primeiro login só funciona para um usuário local
já criado (vinculado por e-mail verificado). O padrão `1` facilita o piloto; em produção com
provedor que aceita contas externas, prefira `0` e provisione via administração.

Limitações: `state`/`nonce` ficam em memória (uma instância); reinício no meio do login
pede nova tentativa; logout no provedor (single logout) não é propagado.

### Auditoria de exportações

Excel, PDF e CSV chamam `POST /api/audit/export`; o servidor grava `acao=exportacao` com
tipo e filtros ativos. A chamada é best-effort: indisponibilidade da API não bloqueia o
download, mas a ausência do evento fica visível para o administrador.

## 5. Backup, retenção e LGPD

| Item | Frequência | Procedimento |
| --- | --- | --- |
| PostgreSQL `dw` | diária | `pg_dump -Fc meridian > meridian-$(date +%F).dump` ou `npm run backup` |
| `data/` (inclui importações) | diária | `scripts/backup.sh` empacota em `arquivos.tar.gz` |
| `config/` e `.secrets/` | a cada mudança | cofre de segredos, nunca no Git |
| `logs/auditoria.jsonl` | diária | retenção conforme política (ex.: 12 meses) |
| Restauração | trimestral | testar em ambiente separado, nunca só documentar |

O script `scripts/backup.sh` grava dump do PostgreSQL (quando `pg_dump` existe),
`arquivos.tar.gz`, checksums SHA-256, `manifest.txt` e aplica retenção
(`BACKUP_KEEP_DAYS`, padrão 14). Agende no cron e replique para storage externo; detalhes
e comandos de restauração em [`deploy/README.md`](../deploy/README.md).

- Dados pessoais aparecem em comprador, usuário e logs de acesso. Evite exportar nomes
  quando não necessário e defina prazo de retenção.
- A auditoria registra login, falha de login, login SSO, importação, importação rejeitada,
  remoção, alteração de usuários e exportações Excel/PDF/CSV.
- Não versionar `config/empresa.json`, `config/usuarios.json`, `.secrets/`, `logs/`,
  `backups/`, `data/imported/` nem `data/backups/` (já estão no `.gitignore`).

---

## 6. Aceitação e go-live

Checklist mínimo:

- [ ] `node scripts/importar_erp.mjs` sem erros e avisos revisados.
- [ ] spend, pedidos, OTIF e savings conciliados com o ERP em 2 meses fechados.
- [ ] PostgreSQL carregado e `vw_integridade_checklist` sem ocorrências.
- [ ] Power BI publicado com gateway/atualização agendada (se aplicável).
- [ ] login testado para cada papel; leitor não importa nem administra.
- [ ] escopo por unidade testado com um usuário restrito.
- [ ] HTTPS, cookie seguro, segredo de sessão fora do Git.
- [ ] backup e restauração testados; retenção aprovada por segurança/LGPD.
- [ ] importação inválida rejeitada e registrada na auditoria.
- [ ] dono funcional e dono técnico definidos; janela de atualização acordada.

### Runbook rápido

| Sintoma | Verificação | Ação |
| --- | --- | --- |
| painel abre vazio | `data/fato_pedidos.csv` e `data/config.json` existem? | importar novamente / restaurar volume |
| importação 422 | resposta `errors` da API ou relatório | corrigir mapeamento/cadastro |
| login em loop | cookie `Secure` sem HTTPS? | `MERIDIAN_SECURE_COOKIE=0` ou ativar TLS |
| SSO retorna `erro=oidc` | redirect URI, issuer e relógio do servidor | conferir registro no provedor e logs |
| SSO retorna `erro=oidc_estado` | reinício do app durante o login | repetir; estado expira em 10 min |
| admin não vê o menu | papel ou sessão antiga | usar `scripts/usuarios.mjs listar` e refazer login |
| números divergem do ERP | período, cancelados, frete e baseline | conferir regra de spend/saving |
| ETL falha em FK | calendário ou dimensão ausente | ampliar calendário / completar cadastro |
| auditoria não cresce | volume `logs` com permissão? | ajustar volume/permissões |

---

## 7. Limites conhecidos (transparência)

- **Uma empresa por instalação.** Para um grupo com várias empresas, use um banco/volume
  por CNPJ ou evolua o modelo com `id_empresa` em todas as tabelas.
- **SSO sem single logout e com state em memória.** OIDC cobre Azure AD/Entra, Google,
  Okta e Keycloak; MFA depende do provedor (contas locais ainda não têm TOTP). Em múltiplas
  réplicas, use sticky session ou um store compartilhado para `state`.
- **Escopo por linha aplica-se aos CSVs servidos**, não a um data warehouse já baixado.
- **A exportação é auditada via API best-effort.** Se a rede falhar entre o download e o
  `POST /api/audit/export`, o evento pode não ser gravado; o download continua funcionando.
- **Upload do painel é para CSV de pedidos**; volumes grandes e múltiplas tabelas devem
  entrar pelo importador + ETL.
- **O painel web carrega os fatos em memória.** Até ~200 mil pedidos a experiência é boa;
  acima disso, use o Power BI/PostgreSQL ou evolua a API para paginação e agregação no
  servidor.
- **A formatação do painel é pt-BR/BRL.** `moeda` e `locale` ficam no perfil para evolução,
  mas os formatadores do painel web ainda são brasileiros; fora do Brasil, use o Power BI
  ou ajuste `app/js/util.js`.
- **A previsão é regressão linear**, não um modelo sazonal. Trate como referência, não
  como premissa orçamentária.
- **Uma instância do servidor de produção por volume.** Importações concorrentes de dois
  processos no mesmo diretório podem se sobrescrever; escale com uma fila/banco antes de
  rodar múltiplas réplicas.

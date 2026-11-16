# Decisões técnicas (ADRs resumidos)

Registro das escolhas que moldaram o projeto, com contexto, decisão e consequência. O
objetivo é que qualquer pessoa consiga reconstruir o raciocínio — inclusive as alternativas
descartadas.

---

## ADR-01 · Modelo estrela com grão de pedido

**Contexto:** o dashboard precisa responder perguntas de custo, prazo, qualidade e risco ao
mesmo tempo, com filtros combinados.

**Decisão:** fato principal em grão de pedido (item/fornecedor/unidade), dimensões
conformadas e uma tabela de fatos separada para cotações.

**Consequência:** consultas simples e rápidas, sem fan-out. Cotações perdedoras não se
misturam ao custo realizado. Custo: dois fatos para manter coerentes — mitigado por
`vw_requisicao_negociacao` e pela validação de chave.

**Alternativas descartadas:** tabela única “achatada” (impossível comparar propostas sem
duplicar pedidos) e snowflake completo (joins desnecessários para 6 dimensões).

---

## ADR-02 · Savings sobre preço de referência, não sobre “primeira cotação”

**Contexto:** medir economia comparando com a primeira proposta infla o resultado e é
sensível à ordem em que as propostas chegam.

**Decisão:** baseline = `preco_referencia` do catálogo, atualizado pela inflação da
categoria (`drift_mensal`), registrado no próprio pedido.

**Consequência:** número auditável, comparável entre meses e categorias. O baseline precisa
ser governado (revisão trimestral) — por isso ele é uma coluna do fato, congelada no momento
da compra.

---

## ADR-03 · OTIF como flag no grão do pedido

**Contexto:** prazo, completude e qualidade são frequentemente medidos separadamente, o que
permite “compensar” um pedido atrasado com outro perfeito.

**Decisão:** `otif = 1` somente quando `atraso_dias = 0`, `qtd_recebida >= quantidade` e
`qtd_defeito = 0`, calculado na origem e reconciliado no ETL.

**Consequência:** métrica dura, alinhada ao que o negócio sente. Efeito colateral: OTIF
oscila mais em bases pequenas; o painel sempre exibe o volume de entregas ao lado.

---

## ADR-04 · Salvar `saving_valor` no fato

**Contexto:** recalcular savings a cada consulta exigiria reconstruir o baseline histórico.

**Decisão:** persistir o valor no momento da carga, junto com `preco_referencia`.

**Consequência:** consultas triviais e resultado imutável (não muda quando o catálogo é
reajustado). Contrapartida: se a regra de negócio mudar, é preciso reprocessar o histórico —
documentado e coberto por teste de reconciliação.

---

## ADR-05 · Painel sem framework, com SVG próprio

**Contexto:** o projeto precisa rodar em qualquer máquina, sem instalar nada, e ainda assim
ser visualmente forte.

**Decisão:** HTML + CSS + ES Modules puros. Gráficos em SVG gerados por funções próprias.
XLSX escrito como OOXML/ZIP no navegador. Nenhuma dependência de CDN.

**Consequência:** `npm start` e pronto; funciona offline; bundle pequeno e controlável.
Custo: mais código de gráfico para manter (≈ 450 linhas) e ausência de recursos avançados de
bibliotecas (zoom, brush). Para o escopo analítico, o trade-off compensa.

**Alternativas descartadas:** React + Recharts (build, dependências, peso) e Chart.js via CDN
(falha offline e não permite o controle fino da estética pastel).

---

## ADR-06 · Excel nativo gerado no cliente

**Contexto:** “baixar em Excel” não pode significar CSV renomeado.

**Decisão:** implementar um escritor XLSX mínimo (ZIP store-only + OOXML) com estilos,
formatos de moeda/percentual, cabeçalho congelado, autofiltro e 5 abas.

**Consequência:** arquivo abre no Excel/LibreOffice sem avisos, mantendo tipos numéricos.
Custo: 180 linhas de geração e manutenção do XML; validado por teste de CRC/estrutura ZIP.

---

## ADR-07 · PDF via layout de impressão dedicado

**Contexto:** relatório executivo precisa ser compartilhável e fiel ao design.

**Decisão:** construir duas páginas A4 em HTML com CSS de impressão (`@page`, quebras,
tabelas e gráficos vetoriais) e acionar a impressão com `document.title` de arquivo.

**Consequência:** zero dependência, texto selecionável, gráficos nítidos e layout previsível.
Limitação: o usuário escolhe “Salvar como PDF” no diálogo — comportamento aceitável e
explicitado na interface.

---

## ADR-08 · Upload validado no navegador

**Contexto:** o requisito “subir dados” não pode comprometer a integridade do painel.

**Decisão:** validação em duas camadas — schema obrigatório e regras de linha (datas reais,
chaves existentes, valores positivos, consistência de total, duplicidade). Erros bloqueiam;
avisos permitem aplicar. Upsert por `id_pedido`, recálculo imediato e persistência em
`localStorage`.

**Consequência:** iterativo e seguro para demonstração. Em produção, o mesmo contrato de
schema é aplicado pelo `pipeline_etl.py` antes da carga no PostgreSQL.

---

## ADR-09 · Estética pastel com função

**Contexto:** o pedido era um painel visual em tons pastéis, sem perder legibilidade.

**Decisão:** paleta pastel como codificação semântica (8 cores para 8 categorias; verde/âmbar/
vermelho suave para status), fundo off-white quente, cartões brancos com sombra difusa,
tipografia sistema com números tabulares, bordas de 1 px e raios de 14–20 px.

**Consequência:** identidade visual coerente e leve. Contraste de texto garantido pelo uso de
`#2F2B3A` sobre branco; pastéis nunca carregam texto pequeno. Gráficos usam opacidade e
gradientes em vez de saturação.

---

## ADR-10 · Dados sintéticos determinísticos

**Contexto:** portfólio precisa de dados realistas, reprodutíveis e sem risco de privacidade.

**Decisão:** gerador com seed fixa (`20261116`), regras explícitas de sazonalidade, inflação,
competitividade e execução. CSVs versionados; geração disponível em Node e Python.

**Consequência:** qualquer pessoa regenera exatamente a mesma base; números do README e do
dashboard permanecem válidos. Custo: ajustes de cenário exigem mudar o gerador e regerar.

---

## ADR-11 · PostgreSQL como camada gold

**Contexto:** SQL é parte central do escopo e o modelo precisa ser inspecionável fora do
Power BI.

**Decisão:** DDL completo com constraints, comentários, índices e views de KPI; carga via
`psycopg2` em transação única.

**Consequência:** o mesmo modelo serve Power BI (import/DirectQuery) e o painel web; o
significado dos campos fica documentado no banco. Custo: ambiente adicional para rodar o
pipeline — o painel web funciona sem ele, por desenho.

---

## ADR-12 · Regras de KPI em módulo puro e testável

**Contexto:** as mesmas regras apareciam em JavaScript, SQL, DAX e Power Query; pequenas
diferenças (cancelados no savings, cotações sem vencedora, fornecedor sem entrega) geravam
divergências difíceis de detectar.

**Decisão:** `app/js/kpi.js` concentra OTIF, score, HHI, contratos, previsão e simulação.
O painel importa essas funções; SQL/DAX replicam a mesma definição; testes Node, Python e
PostgreSQL verificam a paridade.

**Consequência:** mudar uma regra exige atualizar o módulo, as fontes SQL/DAX e os testes.
O CI bloqueia divergências de `vw_kpi_geral` e da carteira contratual. Custo: uma camada a
mais para manter; benefício: governança real do indicador.

---

## ADR-13 · Score sem histórico artificial e contratos por vigência

**Contexto:** fornecedores novos não tinham entregas ou propostas vencedoras e recebiam
score 0 (SQL/painel) ou blank (DAX). Contratos expirados com pedidos em aberto não apareciam
como risco.

**Decisão:** pilares ausentes são excluídos, os pesos restantes renormalizados e o score só
é publicado com 3+ pilares. A carteira contratual deriva situação, saldo, execução e
exposição por fornecedor + categoria + vigência, com alerta crítico para vencido com pedido
ativo.

**Consequência:** comparabilidade honesta entre fornecedores e visão de risco contratual.
Enquanto `id_contrato` não for persistido no fato, contratos sobrepostos podem atribuir o
mesmo pedido a mais de um contrato.

---

## Convenções

- Commits no padrão `tipo(escopo): descrição` (`feat(kpi): adiciona HHI por categoria`).
- Versionamento semântico do dataset (`data/VERSION` conceitual: mudança de schema = major).
- Toda medida nova entra em `dax/medidas.dax` com comentário e view equivalente em
  `sql/02_views_kpi.sql`; a regra canônica vai para `app/js/kpi.js` e para os testes.
- Nada de número “mágico” no front: metas vivem em constantes documentadas (`0.06`, `0.90`).
- Alteração de definição de KPI exige: versão, changelog, reprocessamento e reconciliação no CI.

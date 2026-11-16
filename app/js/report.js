/* Relatório executivo (PDF via impressão), Excel (XLSX nativo) e CSV. */
import { brl, brlFull, num, pct, signedPct, monthLabel, dateBR, esc, PALETTE, nowStamp, download, toCSV } from "./util.js";
import { store, delivered, validSpend } from "./data.js";
import { lineChart, donut } from "./charts.js";
import { buildXLSX } from "./xlsx.js";

function filterSummary(c) {
  const f = c.filters;
  const parts = [`${dateBR(c.bounds.from, false)} a ${dateBR(c.bounds.to, false)}`];
  const u = store.dim.unidades.find((x) => x.id_unidade === f.unidade)?.unidade;
  const cat = store.dim.categorias.find((x) => x.id_categoria === f.categoria)?.categoria;
  const comp = store.dim.compradores.find((x) => x.id_comprador === f.comprador)?.comprador;
  const forn = store.dim.fornecedores.find((x) => x.id_fornecedor === f.fornecedor)?.razao_social;
  if (u) parts.push(u);
  if (cat) parts.push(cat);
  if (comp) parts.push(`Comprador: ${comp}`);
  if (forn) parts.push(`Fornecedor: ${forn}`);
  if (f.status) parts.push(`Status: ${f.status}`);
  return parts.join(" · ");
}

/* --------------------------------- Excel --------------------------------- */
export function exportExcel(c) {
  const k = c.k;
  const resumo = [
    ["Spend no período", brlFull(k.spend), "Orçamento", brlFull(k.budget)],
    ["Economia obtida", brlFull(k.saving), "Taxa de economia", pct(k.savingRate)],
    ["Aderência ao orçamento", pct(k.adherence, 1), "Variação de spend vs. período anterior", k.spendDelta == null ? "—" : signedPct(k.spendDelta)],
    ["OTIF", pct(k.otif), "Entregas atrasadas", pct(k.lateShare)],
    ["Lead time médio (dias)", num(k.leadTime, 1), "Atraso médio (dias)", num(k.avgDelay, 1)],
    ["Fornecedores ativos", num(k.suppliersCount), "Concentração top 5", pct(k.top5Share)],
    ["HHI", num(k.hhi, 0), "Cobertura contratual", pct(k.contractShare)],
    ["Requisições cotadas", num(k.reqCount), "Pedidos emitidos", num(k.orders)],
    ["Filtros aplicados", filterSummary({ ...c, filters: c.filters }), "Gerado em", new Date().toLocaleString("pt-BR")],
  ];

  const sheets = [
    {
      name: "Resumo",
      columns: [{ header: "Indicador", width: 34 }, { header: "Valor", width: 26 }, { header: "Indicador (contraponto)", width: 34 }, { header: "Valor", width: 24 }],
      rows: resumo,
    },
    {
      name: "Categorias",
      columns: [
        { header: "Categoria", width: 30 }, { header: "Grupo", width: 20 },
        { header: "Spend (R$)", width: 16, type: "money" }, { header: "Economia (R$)", width: 16, type: "money" },
        { header: "% Economia", width: 12, type: "pct" }, { header: "Pedidos", width: 10, type: "int" },
        { header: "OTIF", width: 10, type: "pct" }, { header: "Lead time (d)", width: 13, type: "num" },
      ],
      rows: c.cats.map((x) => [x.nome, x.grupo, x.spend, x.saving, x.savingRate, x.orders, x.otif ?? "", x.lead]),
    },
    {
      name: "Fornecedores",
      columns: [
        { header: "Fornecedor", width: 38 }, { header: "Categoria", width: 26 }, { header: "UF", width: 6 },
        { header: "Risco", width: 9 }, { header: "Spend (R$)", width: 16, type: "money" },
        { header: "Pedidos", width: 9, type: "int" }, { header: "OTIF", width: 9, type: "pct" },
        { header: "Atraso médio", width: 12, type: "num" }, { header: "Defeitos", width: 10, type: "pct" },
        { header: "Rating", width: 9, type: "int" }, { header: "Score", width: 9, type: "num" },
      ],
      rows: c.suppliers.map((s) => [s.nome, s.categoria, s.uf, s.risco, s.spend, s.orders, s.otif, s.delay, s.defectRate, s.rating, s.score == null ? "" : Number(s.score.toFixed(2))]),
    },
    {
      name: "Pedidos",
      columns: [
        { header: "Pedido", width: 16 }, { header: "Emissão", width: 12 }, { header: "Fornecedor", width: 34 },
        { header: "Categoria", width: 24 }, { header: "Unidade", width: 20 }, { header: "Valor total", width: 15, type: "money" },
        { header: "Referência", width: 15, type: "money" }, { header: "Economia", width: 14, type: "money" },
        { header: "Status", width: 12 }, { header: "Entrega prevista", width: 15 },
        { header: "Entrega real", width: 13 }, { header: "Atraso (d)", width: 10, type: "int" }, { header: "OTIF", width: 7, type: "int" },
      ],
      rows: c.pedidos.slice(0, 6000).map((p) => [
        p.id_pedido, p.data_emissao, p.fornecedor?.razao_social || p.id_fornecedor,
        p.categoria?.categoria || p.id_categoria,
        p.unidade?.unidade || p.id_unidade,
        p.valor_total, p.preco_referencia ? p.preco_referencia * p.quantidade : "",
        p.saving_valor, p.status, p.data_entrega_prevista, p.data_entrega_real || "", p.atraso_dias, p.otif,
      ]),
    },
    {
      name: "Cotações",
      columns: [
        { header: "Requisição", width: 16 }, { header: "Data", width: 12 }, { header: "Item", width: 36 },
        { header: "Fornecedor", width: 34 }, { header: "Qtd.", width: 10, type: "int" },
        { header: "Preço unit.", width: 13, type: "money" }, { header: "Referência", width: 13, type: "money" },
        { header: "Desvio", width: 10, type: "pct" }, { header: "Total", width: 14, type: "money" },
        { header: "Selecionada", width: 11, type: "int" },
      ],
      rows: c.cotacoes.slice(0, 6000).map((q) => [
        q.id_requisicao, q.data_cotacao, q.item?.descricao || q.id_item,
        q.fornecedor?.razao_social || q.id_fornecedor, q.quantidade, q.preco_unitario, q.preco_referencia,
        q.preco_referencia ? q.preco_unitario / q.preco_referencia - 1 : "", q.valor_total, q.selecionada,
      ]),
    },
  ];

  download(`meridian_compras_${nowStamp()}.xlsx`, buildXLSX(sheets));
}

/* ---------------------------------- PDF ---------------------------------- */
export function exportPDF(c) {
  const k = c.k;
  const rep = document.getElementById("print-report");
  const topSup = c.suppliers.slice(0, 10);
  const worst = [...c.suppliers].filter((s) => s.orders >= 4 && s.otif != null).sort((a, b) => a.otif - b.otif).slice(0, 8);
  const obs = c.prices.categorias.filter((x) => Math.abs(x.variacao) > 0.01).slice(0, 6);

  const rk = (label, value, sub = "") => `<div class="r-kpi"><span>${esc(label)}</span><strong>${value}</strong>${sub ? `<div style="font-size:7.5pt;color:#7d7689">${sub}</div>` : ""}</div>`;

  rep.innerHTML = `
  <div class="rpage">
    <div class="r-head">
      <div>
        <h1>Relatório Executivo · Compras &amp; Fornecedores</h1>
        <p>Grupo Meridian · ${esc(filterSummary(c))}</p>
      </div>
      <div style="text-align:right">
        <div style="font-size:9pt;font-weight:600">Meridian BI</div>
        <div style="font-size:8pt;color:#6b6478">${new Date().toLocaleString("pt-BR")}</div>
      </div>
    </div>

    <div class="r-kpis">
      ${rk("Spend no período", brl(k.spend), `${num(k.orders)} pedidos`)}
      ${rk("Economia obtida", brl(k.saving), `${pct(k.savingRate)} sobre o spend`)}
      ${rk("Aderência ao orçamento", pct(k.adherence, 0), `orçado ${brl(k.budget)}`)}
      ${rk("OTIF", pct(k.otif), "meta 90%")}
      ${rk("Lead time médio", `${num(k.leadTime, 1)} d`, `atraso médio ${num(k.avgDelay, 1)} d`)}
      ${rk("Fornecedores ativos", num(k.suppliersCount), `top 5 = ${pct(k.top5Share, 0)}`)}
      ${rk("Cobertura contratual", pct(k.contractShare, 0), "do spend")}
      ${rk("HHI", num(k.hhi, 0), "concentração de fornecimento")}
    </div>

    <div class="r-section">1. Spend, orçamento e economia</div>
    <div class="r-box"><h3>Realizado vs. orçamento (mensal)</h3>
      ${lineChart({ labels: c.months, series: [
        { name: "Realizado", color: PALETTE.lilac, values: c.spendSeries },
        { name: "Orçamento", color: PALETTE.mint, values: c.budgetM, dashed: true },
      ], height: 190 })}</div>
    <div class="r-grid" style="margin-top:10px">
      <div class="r-box"><h3>Spend por categoria</h3>
        <div style="display:flex;gap:6px;align-items:center">
          ${donut({ items: c.cats.slice(0, 7).map((x, i) => ({ label: x.nome, value: x.spend, color: [PALETTE.mint, PALETTE.lilac, PALETTE.blush, PALETTE.butter, PALETTE.sky, PALETTE.rose, PALETTE.sage][i] })), center: { value: brl(k.spend), label: "spend" }, size: 132, thickness: 17 })}
          <div style="flex:1;font-size:7.5pt;line-height:1.6">
            ${c.cats.slice(0, 7).map((x, i) => `<div style="display:flex;gap:4px"><span style="width:5px;height:5px;border-radius:2px;margin-top:4px;background:${[PALETTE.mint, PALETTE.lilac, PALETTE.blush, PALETTE.butter, PALETTE.sky, PALETTE.rose, PALETTE.sage][i]}"></span><span style="flex:1">${esc(x.nome)}</span><span style="color:#7d7689">${pct(x.share)}</span></div>`).join("")}
          </div>
        </div>
      </div>
      <div class="r-box"><h3>Economia por categoria</h3>
        <table class="r-table">
          <thead><tr><th>Categoria</th><th class="r">Spend</th><th class="r">Economia</th><th class="r">%</th></tr></thead>
          <tbody>${c.cats.slice(0, 6).map((x) => `<tr><td>${esc(x.nome)}</td><td class="r">${brl(x.spend)}</td><td class="r">${brl(x.saving)}</td><td class="r">${pct(x.savingRate)}</td></tr>`).join("")}</tbody>
        </table>
      </div>
    </div>

    <div class="r-section">2. Desempenho de fornecedores</div>
    <table class="r-table">
      <thead><tr><th>Fornecedor</th><th>Categoria</th><th class="r">Spend</th><th class="r">Pedidos</th><th class="r">OTIF</th><th class="r">Atraso</th><th class="r">Defeitos</th><th class="r">Score</th><th>Risco</th></tr></thead>
      <tbody>${topSup.map((s) => `<tr><td>${esc(s.nome)}</td><td>${esc(s.categoria)}</td><td class="r">${brl(s.spend)}</td><td class="r">${s.orders}</td><td class="r">${pct(s.otif)}</td><td class="r">${num(s.delay, 1)} d</td><td class="r">${pct(s.defectRate, 2)}</td><td class="r">${s.score == null ? "—" : s.score.toFixed(1)}</td><td>${esc(s.risco)}</td></tr>`).join("")}</tbody>
    </table>
    <div class="r-foot"><span>Top 10 fornecedores por spend · score = prazo 35% + qualidade 25% + preço 25% + conformidade 15%</span><span>Meridian BI · página 1/2</span></div>
  </div>

  <div class="rpage">
    <div class="r-head">
      <div><h1>Prazos, qualidade e preços</h1><p>${esc(filterSummary(c))}</p></div>
      <div style="text-align:right;font-size:8pt;color:#6b6478">Continuação</div>
    </div>

    <div class="r-section">3. Prazos e qualidade</div>
    <div class="r-box"><h3>OTIF mensal vs. meta de 90%</h3>
      ${lineChart({ labels: c.months, series: [{ name: "OTIF", color: PALETTE.mint, values: c.months.map((m) => { const rows = c.pedidos.filter((p) => delivered(p) && p.mes === m); return rows.length ? rows.reduce((s, p) => s + p.otif, 0) / rows.length : null; }) }], height: 180, yFmt: (v) => pct(v, 0), target: { value: 0.9, label: "meta" }, yMax: 1 })}</div>
    <div class="r-grid" style="margin-top:10px">
      <div class="r-box"><h3>Fornecedores com pior OTIF</h3>
        <table class="r-table">
          <thead><tr><th>Fornecedor</th><th class="r">OTIF</th><th class="r">Atraso</th><th class="r">Spend</th></tr></thead>
          <tbody>${worst.map((s) => `<tr><td>${esc(s.nome)}</td><td class="r">${pct(s.otif)}</td><td class="r">${num(s.delay, 1)} d</td><td class="r">${brl(s.spend)}</td></tr>`).join("")}</tbody>
        </table>
      </div>
      <div class="r-box"><h3>Variação de preços em 12 meses</h3>
        <table class="r-table">
          <thead><tr><th>Categoria</th><th class="r">Variação</th><th class="r">Spend</th></tr></thead>
          <tbody>${obs.map((x) => `<tr><td>${esc(x.nome)}</td><td class="r">${signedPct(x.variacao)}</td><td class="r">${brl(x.spend)}</td></tr>`).join("")}</tbody>
        </table>
        <p class="r-note" style="margin-top:6px">Inflação média ponderada do portfólio: <strong>${signedPct(c.prices.variacaoGeral)}</strong> em 12 meses.</p>
      </div>
    </div>

    <div class="r-section">4. Pontos de atenção e recomendações</div>
    <table class="r-table">
      <thead><tr><th style="width:38%">Tema</th><th>Recomendação</th></tr></thead>
      <tbody>
        ${c.suppliers.filter((s) => s.risco === "Alto").slice(0, 3).map((s) => `<tr><td>Fornecedor de alto risco: ${esc(s.nome)}</td><td>${brl(s.spend)} em risco · OTIF ${pct(s.otif)} · revisar homologação, garantias e plano de contingência.</td></tr>`).join("")}
        ${c.cats.filter((x) => x.otif != null && x.otif < 0.85).slice(0, 3).map((x) => `<tr><td>OTIF abaixo de 85% em ${esc(x.nome)}</td><td>${pct(x.otif)} de OTIF com lead time de ${num(x.lead, 1)} dias · reforçar SLA e estoque de segurança.</td></tr>`).join("")}
        ${c.prices.categorias.filter((x) => x.variacao > 0.03).slice(0, 3).map((x) => `<tr><td>Pressão de preços em ${esc(x.nome)}</td><td>${signedPct(x.variacao)} em 12 meses · antecipar renovação contratual e buscar fornecedor alternativo.</td></tr>`).join("")}
        <tr><td>Cobertura contratual</td><td>${pct(1 - k.contractShare)} do spend fora de contrato · ampliar catálogo e acordos para reduzir compras avulsas.</td></tr>
        <tr><td>Concentração de fornecimento</td><td>Top 5 concentram ${pct(k.top5Share, 0)} do spend (HHI ${num(k.hhi, 0)}) · desenvolver segundo fornecedor nas categorias críticas.</td></tr>
      </tbody>
    </table>

    <div class="r-foot">
      <span>Fonte: camada gold (pedidos, cotações, preços e orçamento) · modelo estrela · atualizado em ${store.loadedAt ? store.loadedAt.toLocaleDateString("pt-BR") : "—"}</span>
      <span>Meridian BI · página 2/2</span>
    </div>
  </div>`;

  const prevTitle = document.title;
  document.title = `Relatorio_Compras_${nowStamp()}`;
  setTimeout(() => {
    window.print();
    setTimeout(() => { document.title = prevTitle; }, 800);
  }, 120);
}

/* ---------------------------------- CSV ---------------------------------- */
export function exportPedidos(c) {
  const header = ["id_pedido", "data_emissao", "id_fornecedor", "fornecedor", "id_categoria", "categoria", "id_unidade", "valor_total", "saving_valor", "status", "data_entrega_prevista", "data_entrega_real", "atraso_dias", "otif"];
  const rows = c.pedidos.map((p) => [
    p.id_pedido, p.data_emissao, p.id_fornecedor, p.fornecedor?.razao_social || "", p.id_categoria,
    p.categoria?.categoria || "", p.id_unidade, p.valor_total, p.saving_valor, p.status,
    p.data_entrega_prevista, p.data_entrega_real, p.atraso_dias, p.otif,
  ]);
  download(`meridian_pedidos_${nowStamp()}.csv`, "\uFEFF" + toCSV(header, rows));
}

export function exportCotacoes(c) {
  const header = ["id_requisicao", "data_cotacao", "id_fornecedor", "fornecedor", "id_item", "item", "quantidade", "preco_unitario", "preco_referencia", "desvio_pct", "valor_total", "selecionada"];
  const rows = c.cotacoes.map((q) => [
    q.id_requisicao, q.data_cotacao, q.id_fornecedor, q.fornecedor?.razao_social || "", q.id_item,
    q.item?.descricao || "", q.quantidade, q.preco_unitario, q.preco_referencia,
    q.preco_referencia ? (q.preco_unitario / q.preco_referencia - 1).toFixed(4) : "", q.valor_total, q.selecionada,
  ]);
  download(`meridian_cotacoes_${nowStamp()}.csv`, "\uFEFF" + toCSV(header, rows));
}

export { filterSummary };

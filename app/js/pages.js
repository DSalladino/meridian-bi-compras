/* Renderização das páginas analíticas. */
import {
  brl, brlFull, num, pct, signedPct, monthLabel, dateBR, esc, SERIES, PALETTE,
  sum, avg, groupBy, median, clamp,
} from "./util.js";
import {
  store, periodBounds, prevBounds, applyFilters, monthsBetween, kpis, spendByMonth,
  budgetByMonth, byCategory, supplierScorecards, priceStats,
  quoteStats, validSpend, delivered, storedUploadsCount, uploadsCount, DATA_MODES, contractsOverview,
} from "./data.js";
import { forecastSpend, simulateRenegotiation, supplierClassification } from "./kpi.js";
import { lineChart, barChart, hbar, donut, scatter, heatmap, radar, gauge, divergingBars, legend } from "./charts.js";
import { renderAdmin } from "./admin.js";

export const ui = { ctx: null, supplier: null, item: null, page: "exec" };

/** Metas vigentes (perfil da empresa). Fallback seguro quando não há config. */
const M = () => store.metas || {};
const pctMeta = (key, digits = 0) => pct(M()[key] ?? 0, digits);

/* ------------------------------- helpers --------------------------------- */
function kpiCard({ label, value, sub = "", delta = null, accent = "mint", foot = "", invert = false, neutral = false }) {
  const dir = delta == null ? null : delta > 0.0005 ? "up" : delta < -0.0005 ? "down" : "flat";
  const good = neutral || dir === "flat" ? "flat" : (dir === "up") !== invert ? "" : "down";
  const dTxt = delta == null ? "" : `<span class="delta ${good}">${delta >= 0 ? "▲" : "▼"} ${pct(Math.abs(delta))}</span>`;
  return `<div class="kpi" data-accent="${accent}">
    <div class="kpi-label">${esc(label)}</div>
    <div class="kpi-value">${value}</div>
    <div class="kpi-foot">${dTxt}${sub ? `<span>${sub}</span>` : ""}${foot}</div>
  </div>`;
}

function card(cls, title, sub, body, tools = "") {
  return `<div class="card ${cls}">
    <div class="card-head"><div><h3>${title}</h3>${sub ? `<p>${sub}</p>` : ""}</div><div class="spacer"></div><div class="card-tools">${tools}</div></div>
    ${body}
  </div>`;
}

function table(headers, rows, foot = "") {
  const th = headers.map((h) => `<th class="${h.cls || ""}">${h.label}</th>`).join("");
  const tr = rows.map((r) => `<tr>${r.map((c) => (typeof c === "string" && c.startsWith("<td") ? c : `<td>${c}</td>`)).join("")}</tr>`).join("");
  return `<div class="table-wrap"><table class="data"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody>${foot ? `<tfoot>${foot}</tfoot>` : ""}</table></div>`;
}

const badge = (text, cls = "") => `<span class="badge ${cls}">${esc(text)}</span>`;
const hhiBand = (v) => {
  if (v == null) return "—";
  const competitive = M().hhiCompetitivo ?? 1500;
  const moderate = M().hhiModerado ?? 2500;
  return v < competitive ? "competitivo" : v <= moderate ? "moderado" : "concentrado";
};
const riskBadge = (r) => badge(r || "—", r === "Baixo" ? "mint" : r === "Médio" ? "butter" : "blush");
const statusBadge = (s) => badge(s, s === "Entregue" ? "mint" : s === "Atrasado" ? "blush" : s === "Cancelado" ? "" : "sky");
const tdR = (v, cls = "") => `<td class="r ${cls}">${v}</td>`;

function scoreBar(score) {
  if (score == null) return `<span class="tiny muted" title="Pilares insuficientes para publicar o score">sem histórico</span>`;
  const c = score >= 80 ? "mint" : score >= 65 ? "" : "blush";
  return `<div class="bar-cell"><div class="bar-track"><div class="bar-fill ${c}" style="width:${clamp(score, 0, 100)}%"></div></div><span class="num">${score.toFixed(1)}</span></div>`;
}

/* ------------------------------- contexto -------------------------------- */
export function buildContext() {
  const f = store.filters;
  const b = periodBounds(f.period, store.maxDate, f, store.minDate);
  const flt = { ...f, from: b.from, to: b.to };
  const cur = applyFilters(store.fato.pedidos, store.fato.cotacoes, flt);
  const pb = prevBounds(b.from, b.to);
  const prev = applyFilters(store.fato.pedidos, store.fato.cotacoes, { ...flt, from: pb.from, to: pb.to });
  const months = monthsBetween(b.from, b.to);
  const k = kpis(cur.pedidos, prev.pedidos, store.fato.orcamento, months, flt);
  const cats = byCategory(cur.pedidos);
  const sup = supplierScorecards(cur.pedidos, cur.cotacoes);
  const prices = priceStats(store.fato.precos, cur.pedidos, flt);
  const qs = quoteStats(cur.cotacoes, cur.pedidos);
  const monthly = spendByMonth(cur.pedidos, months);
  const budgetM = budgetByMonth(store.fato.orcamento, months, flt);
  const spendSeries = months.map((m) => monthly.find((x) => x.mes === m)?.valor || 0);
  const forecast = forecastSpend(monthly, { horizon: 3, budgetSeries: budgetM });
  const contracts = contractsOverview(store.maxDate);

  ui.ctx = {
    filters: flt, months, k, cats, suppliers: sup, prices, quotes: qs, forecast, contracts,
    pedidos: cur.pedidos, cotacoes: cur.cotacoes, prevPedidos: prev.pedidos,
    monthly, budgetM, spendSeries, bounds: b, prevBounds: pb,
  };
  if (!ui.supplier || !sup.some((s) => s.id === ui.supplier)) ui.supplier = sup[0]?.id || null;
  if (!ui.item || !prices.items.some((i) => i.id === ui.item)) ui.item = prices.items[0]?.id || null;
  return ui.ctx;
}

function emptyPage({ title, text, icon = "◌" }) {
  const demo = store.mode !== "demo";
  return `<div class="card empty-state">
    <div class="empty-ico" aria-hidden="true">${icon}</div>
    <h3>${esc(title)}</h3>
    <p>${esc(text)}</p>
    <div class="empty-actions">
      ${demo ? `<button class="btn btn-primary" data-action="restore-demo">Restaurar dataset demo</button>` : ""}
      <a class="btn btn-ghost" data-page="dados" href="#dados">Ir para Dados &amp; importação</a>
    </div>
    <div class="tiny muted">Fonte atual: <strong>${esc(DATA_MODES[store.mode]?.label || store.mode)}</strong></div>
  </div>`;
}

/* ------------------------------ visão executiva --------------------------- */
function pageExec(c) {
  if (!c.pedidos.length) {
    return emptyPage({
      title: "Nenhum pedido no período filtrado",
      text: "A base está vazia ou os filtros não retornaram registros. Restaure o dataset de demonstração ou importe pedidos para visualizar os indicadores.",
      icon: "▤",
    });
  }
  const { k, cats, months, spendSeries, budgetM, prices, monthly, forecast } = c;
  const adher = k.adherence || 0;
  const deltaSpend = k.spendDelta;
  const topSup = c.suppliers.slice(0, 10);

  const kpisHtml = `<div class="kpis">
    ${kpiCard({ label: "Spend no período", value: brl(k.spend), sub: `${num(k.orders)} pedidos`, delta: deltaSpend, accent: "lilac", neutral: true })}
    ${kpiCard({ label: "Economia obtida", value: brl(k.saving), sub: `${pct(k.savingRate)} do spend · meta ${pctMeta("saving", 1)}`, delta: k.savingDelta, accent: "mint" })}
    ${kpiCard({ label: "Aderência ao orçamento", value: pct(adher, 0), sub: `${brl(k.budget)} previstos · meta ≤ ${pctMeta("aderencia")}`, delta: adher ? adher - 1 : null, accent: "butter", invert: true })}
    ${kpiCard({ label: "OTIF", value: pct(k.otif), sub: `meta ${pctMeta("otif")} · prazo + completo`, delta: k.otif - k.otifPrev, accent: "sky" })}
    ${kpiCard({ label: "Lead time médio", value: `${num(k.leadTime, 1)}<small> dias</small>`, sub: `atraso médio ${num(k.avgDelay, 1)} d`, delta: k.leadTimePrev ? k.leadTime / k.leadTimePrev - 1 : null, accent: "sage", invert: true })}
    ${kpiCard({ label: "Concentração top 5", value: pct(k.top5Share, 0), sub: `HHI ${num(k.hhi, 0)} (${hhiBand(k.hhi)}) · ${k.suppliersCount} forn.`, accent: "blush" })}
  </div>`;

  const catLegend = cats.slice(0, 8).map((cat, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:11.5px">
      <i style="width:8px;height:8px;border-radius:3px;background:${SERIES[i % SERIES.length]}"></i>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(cat.nome)}</span>
      <strong class="num">${brl(cat.spend)}</strong>
      <span class="muted num" style="width:40px;text-align:right">${pct(cat.share)}</span>
    </div>`).join("");

  const insights = buildInsights(c);
  const forecastLabels = [...months, ...forecast.months.map((m) => m.mes)];
  const forecastActual = [...spendSeries, ...forecast.months.map(() => null)];
  const forecastValues = [...months.map(() => null), ...forecast.months.map((m) => m.valor)];
  const forecastCard = card("col-12", "Previsão de spend e orçamento", `Projeção para os próximos 3 meses · ${forecast.method}`,
    `<div class="kpis" style="grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:8px">
      ${kpiCard({ label: "Previsão 3 meses", value: brl(forecast.total), sub: `${monthLabel(forecast.months[0].mes, true)} → ${monthLabel(forecast.months[2].mes, true)}`, accent: "lilac", neutral: true })}
      ${kpiCard({ label: "Tendência mensal", value: `${forecast.slope >= 0 ? "+" : "−"}${brl(Math.abs(forecast.slope))}`, sub: `R² ${num(forecast.r2, 2)} · ${forecast.history.length} meses observados`, accent: forecast.slope >= 0 ? "blush" : "mint" })}
      ${kpiCard({ label: "Orçamento de referência", value: brl(forecast.budgetReference), sub: "média dos últimos 3 meses", accent: "butter", neutral: true })}
      ${kpiCard({ label: "Gap projetado", value: brl(forecast.total - forecast.budgetReference * forecast.months.length), sub: "previsão − orçamento de referência", accent: "sky", neutral: true })}
    </div>
    ${lineChart({ labels: forecastLabels, series: [
      { name: "Realizado", color: PALETTE.lilac, values: forecastActual },
      { name: "Previsão", color: PALETTE.mint, values: forecastValues, dashed: true },
    ], height: 210, yFmt: (v) => brl(v) })}`);

  return `${kpisHtml}
  <div class="grid">
    ${card("col-8", "Realizado vs orçamento", "Spend mensal e orçamento aprovado por competência",
      lineChart({
        labels: months,
        series: [
          { name: "Realizado", color: PALETTE.lilac, values: spendSeries },
          { name: "Orçamento", color: PALETTE.mint, values: budgetM, dashed: true },
        ],
        height: 236,
      }), `<span class="chip">${pct(adher, 0)} do orçamento</span>`)}
    ${card("col-4", "Spend por categoria", "Participação no gasto total",
      `<div style="display:flex;justify-content:center">${donut({
        items: cats.map((x, i) => ({ label: x.nome, value: x.spend, color: SERIES[i % SERIES.length] })),
        center: { value: brl(k.spend), label: "spend total" }, size: 200, thickness: 24,
      })}</div>${catLegend}`)}
    ${card("col-7", "Top 10 fornecedores por spend", "Participação no volume comprado no período",
      hbar({ items: topSup.map((s) => ({ label: s.nome, value: s.spend, tip: `${brl(s.spend)} · ${s.orders} pedidos · OTIF ${pct(s.otif)}`, color: PALETTE.lilac })), labelWidth: 210 }))}
    ${card("col-5", "Economia mensal", "Savings capturados sobre o preço de referência",
      barChart({ labels: months, series: [{ name: "Economia", color: PALETTE.mint, values: monthly.map((m) => m.saving) }], height: 226 }) + legend([{ label: "Taxa média de economia", color: PALETTE.lilac }]) + `<div class="muted tiny" style="margin-top:-4px">Média do período: <strong>${pct(k.savingRate)}</strong> · ${brl(k.saving)}</div>`)}
    ${forecastCard}
    ${card("col-8", "Mapa de calor — categoria × mês", "Intensidade do spend mensal por categoria",
      heatmap({
        rows: cats.slice(0, 8).map((x) => x.nome),
        cols: months,
        values: cats.slice(0, 8).map((cat) => months.map((m) => sum(c.pedidos.filter((p) => p.id_categoria === cat.id && p.mes === m), (p) => p.valor_total))),
        color: "#a99bd6", fmt: brl,
      }))}
    ${card("col-4", "Leituras do período", "Sinais automáticos gerados a partir dos filtros ativos",
      `<div class="insights">${insights.map((i) => `<div class="insight ${i.kind}">
        <div class="ico">${i.icon}</div><div><strong>${i.title}</strong><p>${i.text}</p></div></div>`).join("")}</div>
        <div class="hdivider"></div>
        <div class="tiny muted">Inflação ponderada de preços em 12 meses: <strong>${signedPct(prices.variacaoGeral)}</strong> · ${prices.altas} itens em alta</div>`)}
  </div>`;
}

function buildInsights(c) {
  const { k, cats, prices, suppliers } = c;
  const out = [];
  const top = cats[0];
  if (top) out.push({ kind: "info", icon: "◎", title: `${top.nome} concentra ${pct(top.share, 0)} do spend`, text: `${brl(top.spend)} em ${top.orders} pedidos, com OTIF de ${top.otif == null ? "—" : pct(top.otif)} e lead time médio de ${num(top.lead, 1)} dias.` });
  if (k.otif < (M().otif ?? 0.9)) out.push({ kind: "warn", icon: "!", title: `OTIF abaixo da meta (${pct(k.otif)})`, text: `${num(k.lateShare * 100, 0)}% dos pedidos entregues atrasaram; atraso médio de ${num(k.avgDelay, 1)} dias e P90 de ${num(k.p90Delay, 0)} dias.` });
  else out.push({ kind: "", icon: "✓", title: `OTIF dentro da meta (${pct(k.otif)})`, text: `Prazo e completude acima do alvo de ${pctMeta("otif")}, com atraso médio de ${num(k.avgDelay, 1)} dias.` });
  if (k.hhi > (M().hhiCompetitivo ?? 1500) || k.top5Share > 0.4) out.push({ kind: "warn", icon: "◈", title: `Risco de concentração: top 5 = ${pct(k.top5Share, 0)}`, text: `HHI de ${num(k.hhi, 0)} (${hhiBand(k.hhi)}). Avaliar segundo fornecedor homologado por categoria crítica.` });
  if (k.savingRate < (M().saving ?? 0.06)) out.push({ kind: "warn", icon: "↓", title: `Economia de ${pct(k.savingRate)} abaixo da meta`, text: `Faltam ${brl(k.spend * (M().saving ?? 0.06) - k.saving)} para atingir ${pctMeta("saving", 1)} do spend no período.` });
  const maverick = 1 - k.contractShare;
  if (maverick > 0.12) out.push({ kind: "bad", icon: "⚠", title: `${pct(maverick, 0)} do spend fora de contrato`, text: `Compras sem cobertura contratual reduzem alavancagem e previsibilidade. Priorizar catálogo e acordos vigentes.` });
  const risky = suppliers.filter((s) => s.risco === "Alto").reduce((a, s) => a + s.spend, 0);
  if (risky > 0) out.push({ kind: "warn", icon: "◍", title: `${brl(risky)} em fornecedores de alto risco`, text: `Equivalente a ${pct(risky / (k.spend || 1))} do spend. Revisar homologação, garantias e planos de contingência.` });
  const up = prices.categorias.find((x) => x.variacao > 0.02);
  if (up) out.push({ kind: "info", icon: "↗", title: `${up.nome} acumula ${signedPct(up.variacao)} em 12 meses`, text: `Reajuste acima da média do portfólio (${signedPct(prices.variacaoGeral)}). Revisar cláusulas de reajuste e alternativas de fornecimento.` });
  if (k.openCount) out.push({ kind: "info", icon: "◷", title: `${k.openCount} pedidos em aberto (${brl(k.openValue)})`, text: `Inclui pedidos em trânsito, parciais e atrasados. Acompanhar na aba Prazos & qualidade.` });
  return out.slice(0, 6);
}

/* --------------------------- cotações & economia -------------------------- */
function simulationResult(c, discountPct, coveragePct, volumeDeltaPct) {
  const sim = simulateRenegotiation({
    spend: c.k.spend, saving: c.k.saving, discountPct, coveragePct, volumeDeltaPct,
  });
  return {
    ...sim,
    html: `<div class="stat-list">
      <div class="srow"><span>Spend elegível</span><strong class="num">${brl(sim.eligible)}</strong></div>
      <div class="srow"><span>Economia incremental</span><strong class="num" style="color:#3f7d63">${brl(sim.incremental)}</strong></div>
      <div class="srow"><span>Nova economia total</span><strong class="num">${brl(sim.newSaving)}</strong></div>
      <div class="srow"><span>Novo spend</span><strong class="num">${brl(sim.newSpend)}</strong></div>
      <div class="srow"><span>Nova taxa de economia</span><strong class="num">${pct(sim.newSavingRate)}</strong></div>
    </div>
    <div class="tiny muted" style="margin-top:8px">Simulação sobre o recorte filtrado. O desconto incide apenas no spend elegível; o volume altera o spend e a economia proporcionalmente.</div>`,
  };
}

function simulationCard(c) {
  const initial = simulationResult(c, 0.03, 0.6, 0);
  return `<div class="sim-grid" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:10px">
    <label class="tiny muted">Desconto adicional (%)
      <input class="control" id="sim-discount" type="number" min="0" max="30" step="0.5" value="3" style="width:100%;margin-top:4px" />
    </label>
    <label class="tiny muted">Spend elegível (%)
      <input class="control" id="sim-coverage" type="number" min="0" max="100" step="5" value="60" style="width:100%;margin-top:4px" />
    </label>
    <label class="tiny muted">Variação de volume (%)
      <input class="control" id="sim-volume" type="number" min="-50" max="50" step="5" value="0" style="width:100%;margin-top:4px" />
    </label>
  </div>
  <div id="sim-output">${initial.html}</div>`;
}

function pageCotacoes(c) {
  if (!c.cotacoes.length) {
    return emptyPage({
      title: "Nenhuma cotação no período",
      text: "Este modo de dados não possui propostas de negociação. Importe pedidos com requisições ou restaure o dataset demo para analisar o funil de cotações.",
      icon: "◇",
    });
  }
  const { quotes: q, cats } = c;
  const savingsByCat = cats.map((x) => ({ label: x.nome, value: x.saving, tip: `${brl(x.saving)} · ${pct(x.savingRate)} do spend`, color: PALETTE.mint }));
  const itemMap = new Map();
  for (const p of c.pedidos) {
    if (!validSpend(p)) continue;
    const cur = itemMap.get(p.id_item) || { label: p.item?.descricao || p.id_item, value: 0 };
    cur.value += p.saving_valor || 0;
    itemMap.set(p.id_item, cur);
  }
  const topSavings = [...itemMap.values()].sort((a, b) => b.value - a.value).slice(0, 8);

  const win = c.cotacoes.filter((x) => x.selecionada === 1 && x.preco_referencia);
  const maxQ = Math.max(...win.map((x) => x.quantidade * x.preco_referencia), 1);

  const kpisHtml = `<div class="kpis">
    ${kpiCard({ label: "Requisições cotadas", value: num(q.requisicoes), sub: `${num(q.cotacoes)} propostas recebidas`, accent: "lilac" })}
    ${kpiCard({ label: "Cotações por requisição", value: num(q.perReq, 2), sub: `mínimo recomendado: ${M().cotacoesPorRequisicao ?? 3}`, accent: "sky" })}
    ${kpiCard({ label: "Economia capturada", value: brl(q.saving), sub: `${pct(q.savingRate)} sobre o preço de referência`, accent: "mint" })}
    ${kpiCard({ label: "Compras competitivas", value: pct(q.competitiveShare, 0), sub: `requisições com ${M().cotacoesPorRequisicao ?? 3}+ propostas`, accent: "sage" })}
    ${kpiCard({ label: "Aderência ao menor preço", value: pct(q.bestPriceShare, 0), sub: "decisões pelo menor total", accent: "butter" })}
    ${kpiCard({ label: "Spread médio das propostas", value: pct(q.avgSpread, 0), sub: "diferença entre maior e menor", accent: "blush" })}
  </div>`;

  const executive = `<div class="stat-list">
    <div class="srow"><span>Requisições</span><strong class="num">${num(q.requisicoes)}</strong></div>
    <div class="srow"><span>Propostas recebidas</span><strong class="num">${num(q.cotacoes)}</strong></div>
    <div class="srow"><span>Pedidos emitidos</span><strong class="num">${num(c.pedidos.length)}</strong></div>
    <div class="srow"><span>Economia gerada</span><strong class="num" style="color:#3f7d63">${brl(q.saving)}</strong></div>
  </div>
  <div class="hdivider"></div>
  <div class="tiny muted">Gauge de economia sobre o baseline de referência (meta ${pctMeta("saving", 1)}).</div>`;

  const qTable = c.cotacoes.slice(0, 80).map((x) => {
    const dev = x.preco_referencia ? x.preco_unitario / x.preco_referencia - 1 : null;
    return [
      `<td class="mono tiny">${esc(x.id_requisicao)}</td>`,
      `<td class="tiny">${dateBR(x.data_cotacao)}</td>`,
      `<td><div class="name-cell"><strong>${esc((x.item?.descricao || "").slice(0, 34))}</strong><span class="tiny muted">${esc(x.categoria?.categoria || "")}</span></div></td>`,
      `<td>${esc(x.fornecedor?.razao_social || x.id_fornecedor)}</td>`,
      tdR(num(x.quantidade)),
      tdR(brlFull(x.preco_unitario)),
      tdR(brlFull(x.preco_referencia)),
      tdR(dev == null ? "—" : `<span class="badge ${dev <= -0.05 ? "mint" : dev > 0.02 ? "blush" : ""}">${signedPct(dev)}</span>`),
      tdR(brl(x.valor_total)),
      `<td class="r">${x.selecionada === 1 ? badge("Vencedora", "mint") : `<span class="tiny muted">—</span>`}</td>`,
    ];
  });

  return `${kpisHtml}
  <div class="grid">
    ${card("col-8", "Economia por categoria", "Valor absoluto capturado na negociação",
      hbar({ items: savingsByCat, labelWidth: 205, color: PALETTE.mint }) + `<div class="legend"><span><i style="background:${PALETTE.mint}"></i>Savings sobre preço de referência</span></div>`)}
    ${card("col-4", "Funil de negociação", "Da requisição ao resultado capturado", executive + `<div style="display:grid;place-items:center;margin-top:6px">${gauge({ value: Math.min(q.savingRate / (M().saving ?? 0.06), 1), max: 1, label: pct(q.savingRate), sub: `meta ${pctMeta("saving", 1)}`, color: PALETTE.mint, size: 190 })}</div>`)}
    ${card("col-7", "Preço vencedor vs preço de referência", "Pontos abaixo da diagonal indicam negociação acima do baseline de mercado",
      scatter({
        points: win.slice(0, 900).map((x) => ({
          x: x.preco_unitario, y: x.preco_referencia,
          r: 3.5 + (x.quantidade * x.preco_unitario / maxQ) * 6,
          color: x.preco_unitario <= x.preco_referencia ? PALETTE.mint : PALETTE.blush,
          tip: `${x.item?.descricao || ""}\n${x.fornecedor?.razao_social || ""}\nVencedor ${brlFull(x.preco_unitario)} · ref. ${brlFull(x.preco_referencia)}\n${signedPct(x.preco_unitario / x.preco_referencia - 1)}`,
        })),
        xLabel: "Preço unitário negociado (R$)", yLabel: "Preço de referência (R$)",
        xFmt: (v) => brl(v), yFmt: (v) => brl(v), height: 330,
      }), `<span class="chip">${pct(q.bestPriceShare, 0)} menor preço</span>`)}
    ${card("col-5", "Top itens por economia", "Onde a negociação gerou mais valor",
      hbar({ items: topSavings, labelWidth: 175, color: PALETTE.sky }))}
    ${card("col-12", "Simulador de renegociação", "Sensibilidade da economia a desconto adicional, cobertura e volume", simulationCard(c))}
    ${card("col-12", "Propostas recebidas", `Amostra de ${Math.min(80, c.cotacoes.length)} propostas · use os filtros para refinar`,
      table(
        [{ label: "Requisição" }, { label: "Data" }, { label: "Item" }, { label: "Fornecedor" }, { label: "Qtd.", cls: "r" },
         { label: "Preço unit.", cls: "r" }, { label: "Referência", cls: "r" }, { label: "Δ vs ref.", cls: "r" },
         { label: "Total", cls: "r" }, { label: "", cls: "r" }],
        qTable
      ), `<button class="btn btn-sm" data-action="export-quotes">Exportar proposta</button>`)}
  </div>`;
}

/* ------------------------------- fornecedores ----------------------------- */
function pageFornecedores(c) {
  const { k, suppliers } = c;
  if (!suppliers.length) {
    return emptyPage({
      title: "Nenhum fornecedor com pedidos no período",
      text: "O scorecard depende de pedidos válidos. Ajuste os filtros ou carregue uma base com movimentação.",
      icon: "◍",
    });
  }
  const focus = suppliers.find((s) => s.id === ui.supplier) || suppliers[0];
  const medianSpend = median(suppliers, (s) => s.spend);
  const medianOtif = median(suppliers.filter((s) => s.otif != null), (s) => s.otif);
  const ratingAvg = avg(suppliers, (s) => s.rating);
  const scored = suppliers.filter((s) => s.score != null);

  const kpisHtml = `<div class="kpis">
    ${kpiCard({ label: "Fornecedores ativos", value: num(k.suppliersCount), sub: `${num(suppliers.filter((s) => s.risco === "Alto").length)} de alto risco`, accent: "lilac" })}
    ${kpiCard({ label: "Concentração top 5", value: pct(k.top5Share, 0), sub: `HHI ${num(k.hhi, 0)} (${hhiBand(k.hhi)})`, accent: "blush" })}
    ${kpiCard({ label: "Rating cadastral médio", value: num(ratingAvg, 1), sub: "escala 0–100", accent: "sky" })}
    ${kpiCard({ label: "Cobertura contratual", value: pct(k.contractShare, 0), sub: `spend com contrato vigente · meta ${pctMeta("coberturaContrato", 0)}`, accent: "mint" })}
    ${kpiCard({ label: "Score médio ponderado", value: num(avg(scored, (s) => s.score), 1), sub: `${scored.length} fornecedores com histórico suficiente`, accent: "sage" })}
    ${kpiCard({ label: "Fornecedores exclusivos", value: num(suppliers.filter((s) => s.orders >= 3 && s.spend / (k.spend || 1) > 0.02).length), sub: "acima de 2% do spend", accent: "butter" })}
  </div>`;

  const matrix = scatter({
    points: suppliers.filter((s) => s.otif != null).slice(0, 45).map((s) => ({
      x: s.spend, y: s.otif,
      r: 4 + Math.min(10, Math.sqrt(s.orders) * 1.5),
      color: s.risco === "Alto" ? PALETTE.blush : s.risco === "Médio" ? PALETTE.butter : PALETTE.mint,
      label: s.nome.split(" ")[0], highlight: s.spend > medianSpend * 2,
      tip: `${s.nome}\nSpend ${brl(s.spend)} · ${s.orders} pedidos\nOTIF ${pct(s.otif)} · score ${s.score == null ? "—" : s.score.toFixed(1)}\nRisco ${s.risco}`,
    })),
    xLabel: "Spend no período (R$)", yLabel: "OTIF", height: 360,
    yFmt: (v) => pct(v, 0), xFmt: (v) => brl(v),
    quadrants: { x: medianSpend, y: medianOtif, tr: "Alto gasto · alta entrega", tl: "Baixo gasto · alta entrega", br: "Alto gasto · baixa entrega", bl: "Baixo gasto · baixa entrega" },
    yMax: 1, xMax: Math.max(...suppliers.slice(0, 45).map((s) => s.spend)) * 1.08,
  });

  const radarHtml = focus ? `<div style="display:flex;justify-content:center">${radar({
    axes: ["Prazo (OTIF)", "Qualidade", "Competitividade", "Conformidade"],
    series: [{ name: focus.nome, color: PALETTE.lilac, values: [focus.prazoScore ?? 0, focus.qualidade ?? 0, focus.precoScore ?? 0, focus.conformidade ?? 0] }],
    size: 250,
  })}</div>
  <div style="text-align:center;margin-top:4px">
    <div style="font-size:13px;font-weight:650">${esc(focus.nome)}</div>
    <div class="tiny muted">${esc(focus.categoria)} · ${esc(focus.uf || "")} · score ${focus.score == null ? "sem histórico" : focus.score.toFixed(1)} · ${esc(supplierClassification(focus.score))}</div>
    <div style="margin-top:6px">${riskBadge(focus.risco)} ${badge(`OTIF ${pct(focus.otif)}`, focus.otif == null ? "sky" : focus.otif >= (M().otif ?? 0.9) ? "mint" : "blush")}</div>
  </div>
  <div class="hdivider"></div>
  <div class="small-grid">
    <div><span class="muted tiny">Spend</span><strong class="num">${brl(focus.spend)}</strong></div>
    <div><span class="muted tiny">Pedidos</span><strong class="num">${num(focus.orders)}</strong></div>
    <div><span class="muted tiny">Atraso médio</span><strong class="num">${num(focus.delay, 1)} d</strong></div>
    <div><span class="muted tiny">Defeitos</span><strong class="num">${pct(focus.defectRate, 2)}</strong></div>
  </div>` : `<div class="empty">Sem fornecedores no filtro atual.</div>`;

  const rank = suppliers.slice(0, 25).map((s) => [
    `<td><div class="name-cell"><strong>${esc(s.nome)}</strong><span class="tiny muted">${esc(s.uf || "")} · ${esc(s.porte || "")}</span></div></td>`,
    `<td class="tiny">${esc(s.categoria)}</td>`,
    tdR(brl(s.spend)),
    tdR(pct(s.otif)),
    tdR(num(s.delay, 1)),
    tdR(pct(s.defectRate, 1)),
    tdR(pct(s.savingRate)),
    `<td>${scoreBar(s.score)}</td>`,
    `<td>${riskBadge(s.risco)}</td>`,
    `<td class="r"><button class="btn btn-sm btn-ghost" data-action="focus-supplier" data-id="${s.id}">Detalhar</button></td>`,
  ]);

  const ufAgg = [...groupBy(suppliers, (s) => s.uf || "—").entries()].map(([uf, rows]) => ({ label: uf, value: sum(rows, (x) => x.spend), tip: `${rows.length} fornecedores` })).sort((a, b) => b.value - a.value).slice(0, 8);

  const worst = [...suppliers].filter((s) => s.orders >= 5 && s.otif != null).sort((a, b) => a.otif - b.otif).slice(0, 8).map((s) => ({
    label: s.nome, value: s.otif, color: PALETTE.blush,
    display: pct(s.otif), tip: `${brl(s.spend)} · ${s.orders} pedidos`,
  }));

  return `${kpisHtml}
  <div class="grid">
    ${card("col-8", "Matriz de desempenho", "Spend × OTIF · bolha pelo volume de pedidos · cor pelo risco",
      matrix + legend([
        { label: "Risco baixo", color: PALETTE.mint },
        { label: "Risco médio", color: PALETTE.butter },
        { label: "Risco alto", color: PALETTE.blush },
      ]))}
    ${card("col-4", "Scorecard do fornecedor", "Compare os quatro pilares do modelo de avaliação", radarHtml,
      `<select class="control" id="supplier-picker" style="min-width:150px;max-width:170px">${suppliers.slice(0, 60).map((s) => `<option value="${s.id}" ${s.id === focus?.id ? "selected" : ""}>${esc(s.nome.slice(0, 32))}</option>`).join("")}</select>`)}
    ${card("col-7", "Ranking por score composto", "Top 25 fornecedores por spend no período",
      table(
        [{ label: "Fornecedor" }, { label: "Categoria" }, { label: "Spend", cls: "r" }, { label: "OTIF", cls: "r" },
         { label: "Atraso", cls: "r" }, { label: "Defeito", cls: "r" }, { label: "Econ.", cls: "r" },
         { label: "Score" }, { label: "Risco" }, { label: "" }],
        rank
      ))}
    ${card("col-5", "Distribuição geográfica", "Spend por UF do fornecedor",
      hbar({ items: ufAgg, labelWidth: 46, color: PALETTE.sky }))}
    ${card("col-5", "Fornecedores com pior OTIF", "Mínimo de 5 pedidos no período",
      hbar({ items: worst, fmt: (v) => pct(v), labelWidth: 200, color: PALETTE.blush }))}
  </div>`;
}

/* --------------------------------- prazos --------------------------------- */
function pagePrazos(c) {
  const { k, cats, months } = c;
  if (!c.pedidos.length) {
    return emptyPage({
      title: "Nenhum pedido para analisar prazos",
      text: "Sem pedidos não é possível calcular OTIF, atraso ou lead time. Restaure o dataset demo ou importe uma base de pedidos.",
      icon: "◷",
    });
  }
  const del = c.pedidos.filter(delivered);
  const buckets = [0, 1, 3, 7, 15, 30];
  const dist = buckets.map((b, i) => {
    const next = buckets[i + 1] ?? 9999;
    return del.filter((p) => (p.atraso_dias || 0) >= b && (p.atraso_dias || 0) < next).length;
  });
  const distLabels = ["0 d", "1–2 d", "3–6 d", "7–14 d", "15–29 d", "30+ d"];
  const otifByMonth = months.map((m) => {
    const rows = del.filter((p) => p.mes === m);
    return rows.length ? sum(rows, (p) => p.otif) / rows.length : null;
  });

  const open = c.pedidos.filter((p) => ["Em trânsito", "Parcial", "Atrasado"].includes(p.status))
    .sort((a, b) => (a.data_entrega_prevista || "").localeCompare(b.data_entrega_prevista || "")).slice(0, 40)
    .map((p) => {
      const hoje = new Date(store.maxDate);
      const prev = new Date(p.data_entrega_prevista || store.maxDate);
      const overdue = Math.max(0, Math.round((hoje - prev) / 864e5));
      return [
        `<td class="mono tiny">${esc(p.id_pedido)}</td>`,
        `<td>${esc(p.fornecedor?.razao_social || "")}</td>`,
        `<td class="tiny">${esc(p.categoria?.categoria || "")}</td>`,
        tdR(brl(p.valor_total)),
        `<td class="tiny">${dateBR(p.data_entrega_prevista)}</td>`,
        `<td class="r">${overdue > 0 ? `<span class="badge blush">${overdue} d</span>` : `<span class="badge mint">no prazo</span>`}</td>`,
        `<td>${statusBadge(p.status)}</td>`,
      ];
    });

  const kpisHtml = `<div class="kpis">
    ${kpiCard({ label: "OTIF", value: pct(k.otif), sub: `meta ${pctMeta("otif")}`, delta: k.otif - k.otifPrev, accent: "mint" })}
    ${kpiCard({ label: "Entregas atrasadas", value: pct(k.lateShare), sub: `${num(del.filter((p) => (p.atraso_dias || 0) > 0).length)} de ${num(del.length)} entregas`, accent: "blush" })}
    ${kpiCard({ label: "Atraso médio", value: `${num(k.avgDelay, 1)}<small> dias</small>`, sub: `P90 de ${num(k.p90Delay, 1)} dias`, accent: "butter" })}
    ${kpiCard({ label: "Lead time médio", value: `${num(k.leadTime, 1)}<small> dias</small>`, sub: "emissão → entrega real", delta: k.leadTimePrev ? k.leadTime / k.leadTimePrev - 1 : null, accent: "sky", invert: true })}
    ${kpiCard({ label: "Taxa de defeito", value: pct(k.defectRate, 2), sub: "sobre volume recebido", accent: "lilac" })}
    ${kpiCard({ label: "Pedidos em aberto", value: num(k.openCount), sub: `${brl(k.openValue)} expostos`, accent: "sage" })}
  </div>`;

  const catDelay = cats.filter((x) => x.delay != null).map((x) => ({
    label: x.nome, value: x.delay, display: `${num(x.delay, 1)} d`,
    tip: `OTIF ${pct(x.otif)}`, color: x.delay > 4 ? PALETTE.blush : PALETTE.butter,
  }));

  return `${kpisHtml}
  <div class="grid">
    ${card("col-8", "OTIF mensal", "Percentual de pedidos entregues no prazo, completos e sem defeito",
      lineChart({ labels: months, series: [{ name: "OTIF", color: PALETTE.mint, values: otifByMonth }], height: 240, yFmt: (v) => pct(v, 0), target: { value: M().otif ?? 0.9, label: `meta ${pctMeta("otif")}` }, yMax: 1 }))}
    ${card("col-4", "Aderência à meta", "OTIF consolidado do período",
      `<div style="display:grid;place-items:center;padding:6px 0">${gauge({ value: k.otif, max: 1, label: pct(k.otif), sub: `meta ${pctMeta("otif")}`, color: k.otif >= (M().otif ?? 0.9) ? PALETTE.mint : PALETTE.blush, size: 200 })}</div>
       <div class="stat-list">
         <div class="srow"><span>No prazo e completo</span><strong>${num(del.filter((p) => p.otif === 1).length)}</strong></div>
         <div class="srow"><span>Com atraso</span><strong>${num(del.filter((p) => (p.atraso_dias || 0) > 0).length)}</strong></div>
         <div class="srow"><span>Com defeito/avaria</span><strong>${num(del.filter((p) => (p.qtd_defeito || 0) > 0).length)}</strong></div>
       </div>`)}
    ${card("col-6", "Atraso médio por categoria", "Dias corridos entre previsão e entrega real",
      hbar({ items: catDelay, labelWidth: 195, showValue: true }))}
    ${card("col-6", "Distribuição dos atrasos", "Quantidade de entregas por faixa de atraso",
      barChart({ labels: distLabels, series: [{ name: "Entregas", color: PALETTE.butter, values: dist }], height: 232 }) +
      `<div class="tiny muted" style="margin-top:-6px">${num(del.filter((p) => (p.atraso_dias || 0) === 0).length)} entregas sem atraso · ${num(del.length)} no total</div>`)}
    ${card("col-12", "Pedidos em aberto e atrasados", "Priorizados pela data prevista de entrega",
      table(
        [{ label: "Pedido" }, { label: "Fornecedor" }, { label: "Categoria" }, { label: "Valor", cls: "r" },
         { label: "Previsto" }, { label: "Atraso" }, { label: "Status" }],
        open
      ))}
  </div>`;
}

/* --------------------------------- preços --------------------------------- */
function priceCatSeries(c) {
  const cats = c.cats.slice(0, 6).map((x) => x.id);
  const rows = store.fato.precos.filter((p) => cats.includes(p.id_categoria) && c.months.includes(p.mes_ref));
  const byCat = groupBy(rows, (p) => p.id_categoria);
  return cats.filter((id) => byCat.has(id)).map((id) => {
    const arr = byCat.get(id);
    const byMonth = groupBy(arr, (p) => p.mes_ref);
    const first = byMonth.get(c.months.find((m) => byMonth.has(m)));
    const base = first ? avg(first, (p) => p.indice_categoria) : 1;
    return {
      name: c.cats.find((x) => x.id === id)?.nome || id,
      values: c.months.map((m) => {
        const rr = byMonth.get(m);
        return rr && base ? (avg(rr, (p) => p.indice_categoria) / base) * 100 : null;
      }),
    };
  });
}

function pagePrecos(c) {
  const { prices } = c;
  if (!prices.items.length) {
    return emptyPage({
      title: "Nenhuma série de preços disponível",
      text: "A base atual não possui histórico de preços por item. Restaure o dataset demo para visualizar índices e reajustes.",
      icon: "↗",
    });
  }
  const focus = prices.items.find((i) => i.id === ui.item) || prices.items[0];
  const series = focus ? focus.serie.filter((s) => c.months.includes(s.mes)) : [];
  const catSeries = priceCatSeries(c);
  const highs = [...prices.items].filter((i) => i.variacao != null).sort((a, b) => b.variacao - a.variacao);
  const biggest = highs[0];

  const kpisHtml = `<div class="kpis">
    ${kpiCard({ label: "Variação de preços 12m", value: signedPct(prices.variacaoGeral), sub: "ponderada pelo spend", accent: "blush" })}
    ${kpiCard({ label: "Itens em alta", value: num(prices.altas), sub: `de ${num(prices.items.length)} itens monitorados`, accent: "butter" })}
    ${kpiCard({ label: "Maior alta", value: biggest ? signedPct(biggest.variacao) : "—", sub: biggest ? esc(biggest.descricao.slice(0, 34)) : "", accent: "lilac" })}
    ${kpiCard({ label: "Itens em queda", value: num(prices.baixas), sub: "oportunidades de renegociação", accent: "mint" })}
    ${kpiCard({ label: "Categorias em alta", value: num(prices.categorias.filter((x) => x.variacao > 0).length), sub: `de ${num(prices.categorias.length)}`, accent: "sky" })}
    ${kpiCard({ label: "Última competência", value: monthLabel(prices.last), sub: `${num(prices.items.length)} itens na base`, accent: "sage" })}
  </div>`;

  return `${kpisHtml}
  <div class="grid">
    ${card("col-8", "Índice de preços por categoria", `Base 100 em ${monthLabel(c.months[0], true)} · correlação com inflação de insumos`,
      lineChart({
        labels: c.months,
        series: catSeries.map((s, i) => ({ ...s, color: SERIES[i % SERIES.length] })),
        height: 300, yFmt: (v) => num(v, 0), area: false,
      }))}
    ${card("col-4", "Movimentos relevantes", "Variação acumulada de 12 meses",
      divergingBars({
        items: [...highs.slice(0, 4), ...highs.slice(-4)].map((i) => ({
          label: i.descricao, value: i.variacao,
          color: i.variacao >= 0 ? PALETTE.blush : PALETTE.mint,
        })),
        height: 280,
      }))}
    ${card("col-8", "Evolução do preço — item selecionado", focus ? `${esc(focus.descricao)} · preço médio de mercado` : "",
      focus ? lineChart({ labels: series.map((s) => s.mes), series: [{ name: "Preço médio", color: PALETTE.peach, values: series.map((s) => s.preco) }], height: 240, yFmt: (v) => brl(v) }) : `<div class="empty">Sem dados.</div>`,
      `<select class="control" id="item-picker" style="max-width:230px">${prices.items.slice(0, 40).map((i) => `<option value="${i.id}" ${i.id === focus?.id ? "selected" : ""}>${esc(i.descricao.slice(0, 34))}</option>`).join("")}</select>`)}
    ${card("col-4", "Variação por categoria", "Acumulado de 12 meses, ponderado por spend",
      hbar({
        items: prices.categorias.slice(0, 8).map((x) => ({
          label: x.nome, value: x.variacao, display: signedPct(x.variacao),
          color: x.variacao >= 0 ? PALETTE.blush : PALETTE.mint,
        })),
        fmt: (v) => signedPct(v), labelWidth: 150,
      }))}
    ${card("col-12", "Monitor de preços por item", "Comparação com a referência de mercado e exposição financeira",
      table(
        [{ label: "Item" }, { label: "Categoria" }, { label: "Preço atual", cls: "r" }, { label: "12 meses", cls: "r" },
         { label: "Mês", cls: "r" }, { label: "Spend no período", cls: "r" }, { label: "Tendência" }],
        prices.items.slice(0, 28).map((i) => [
          `<td><div class="name-cell"><strong>${esc(i.descricao)}</strong><span class="tiny muted mono">${esc(i.id)}</span></div></td>`,
          `<td class="tiny">${esc(store.idx?.cById.get(i.categoria)?.categoria || "")}</td>`,
          tdR(brlFull(i.preco)),
          tdR(i.variacao == null ? "—" : `<span class="badge ${i.variacao > 0.02 ? "blush" : i.variacao < -0.02 ? "mint" : ""}">${signedPct(i.variacao)}</span>`),
          tdR(signedPct(i.variacaoMes || 0, 2)),
          tdR(brl(i.spend)),
          `<td><div class="bar-track" style="width:90px"><div class="bar-fill ${i.variacao > 0 ? "blush" : "mint"}" style="width:${clamp(Math.abs(i.variacao || 0) * 350, 4, 100)}%"></div></div></td>`,
        ])
      ))}
  </div>`;
}

/* --------------------------- contratos & riscos --------------------------- */
const contractBadge = (situacao) => {
  const cls = situacao === "Vencido" ? "blush" : situacao === "A vencer" ? "butter" : situacao === "Vigente" ? "mint" : situacao === "Suspenso" ? "blush" : "sky";
  return badge(situacao, cls);
};

function pageContratos(c) {
  const { contracts } = c;
  const t = contracts.totals;
  if (!contracts.rows.length) {
    return emptyPage({
      title: "Nenhum contrato na base",
      text: "A gestão contratual depende da dimensão de contratos. Restaure o dataset demo ou carregue o cadastro de contratos no PostgreSQL.",
      icon: "▥",
    });
  }
  const kpisHtml = `<div class="kpis">
    ${kpiCard({ label: "Contratos vigentes", value: num(t.vigentes), sub: `${num(t.contratos)} contratos cadastrados`, accent: "mint" })}
    ${kpiCard({ label: `A vencer em ${M().alertaContratoDias ?? 90} dias`, value: num(t.aVencer90), sub: `limite de alerta: ${M().alertaContratoDias ?? 90} dias · média ${num(t.reajusteMedio, 1)}% de reajuste`, accent: "butter" })}
    ${kpiCard({ label: "Vencidos com pedido ativo", value: num(t.vencidosComPedidoAtivo), sub: `${brl(t.exposicao)} de exposição`, accent: t.vencidosComPedidoAtivo ? "blush" : "sage" })}
    ${kpiCard({ label: "Valor contratado", value: brl(t.valorContratado), sub: "soma do valor anual dos contratos", accent: "lilac" })}
    ${kpiCard({ label: "Realizado vs. contratado", value: pct(t.valorContratado ? t.realizado / t.valorContratado : null, 0), sub: `${brl(t.realizado)} realizados no período de vigência`, accent: "sky" })}
    ${kpiCard({ label: "Saldo contratual", value: brl(t.saldo), sub: `${t.alertasCriticos} alerta(s) crítico(s)`, accent: t.saldo >= 0 ? "sage" : "blush" })}
  </div>`;

  const alerts = contracts.alertas.slice(0, 10).map((a) => {
    const cls = a.level === "critical" ? "bad" : a.level === "warn" ? "warn" : "info";
    const icon = a.level === "critical" ? "⚠" : a.level === "warn" ? "!" : "i";
    return `<div class="insight ${cls}"><div class="ico">${icon}</div><div><strong>${esc(a.contrato.id_contrato)} · ${esc(a.contrato.fornecedor?.razao_social || a.contrato.id_fornecedor)}</strong><p>${esc(a.message)}</p></div></div>`;
  }).join("");

  const rows = contracts.rows.slice(0, 60).map((r) => [
    `<td><div class="name-cell"><strong class="mono tiny">${esc(r.id_contrato)}</strong><span class="tiny muted">${esc(r.categoria?.categoria || r.id_categoria)}</span></div></td>`,
    `<td>${esc(r.fornecedor?.razao_social || r.id_fornecedor)}</td>`,
    `<td class="tiny">${dateBR(r.data_inicio)} → ${dateBR(r.data_fim)}</td>`,
    `<td>${contractBadge(r.situacao)}</td>`,
    tdR(brl(r.valor_anual)),
    tdR(brl(r.realizado)),
    tdR(`<span class="badge ${r.saldo < 0 ? "blush" : "mint"}">${brl(r.saldo)}</span>`),
    tdR(r.execucao == null ? "—" : pct(r.execucao, 0)),
    tdR(`${num(r.reajuste_pct, 2)}% <span class="tiny muted">${esc(r.indice_reajuste)}</span>`),
    tdR(r.exposicao ? `<span class="badge blush">${brl(r.exposicao)}</span>` : "—"),
  ]);

  return `${kpisHtml}
  <div class="grid">
    ${card("col-5", "Alertas contratuais", "Vencimento, reajuste e execução acima do limite", alerts || `<div class="empty">Nenhum alerta no recorte atual.</div>`)}
    ${card("col-7", "Valor contratado por situação", "Distribuição do valor anual dos contratos",
      hbar({
        items: ["Vencido", "A vencer", "Vigente", "Futuro", "Encerrado", "Suspenso"].map((s, i) => ({
          label: s,
          value: sum(contracts.rows.filter((r) => r.situacao === s), (r) => r.valor_anual),
          color: [PALETTE.blush, PALETTE.butter, PALETTE.mint, PALETTE.sky, PALETTE.lilac, PALETTE.rose][i],
          tip: `${contracts.rows.filter((r) => r.situacao === s).length} contrato(s)`,
        })),
        labelWidth: 105,
      }))}
    ${card("col-12", "Carteira de contratos", "Saldo, execução, reajuste e exposição financeira · ordenada por criticidade",
      table(
        [{ label: "Contrato" }, { label: "Fornecedor" }, { label: "Vigência" }, { label: "Situação" },
         { label: "Valor anual", cls: "r" }, { label: "Realizado", cls: "r" }, { label: "Saldo", cls: "r" },
         { label: "Execução", cls: "r" }, { label: "Reajuste", cls: "r" }, { label: "Exposição", cls: "r" }],
        rows
      ), `<span class="chip">${num(t.vencidos)} vencidos · ${num(t.aVencer90)} a vencer</span>`)}
    ${card("col-12", "Regras de gestão contratual", "Como os alertas são calculados",
      `<div class="stat-list">
        <div class="srow"><span>Vencido com pedido ativo</span><strong>crítico · pedido em aberto após <span class="mono">data_fim</span></strong></div>
        <div class="srow"><span>A vencer</span><strong>até ${M().alertaContratoDias ?? 90} dias do vencimento</strong></div>
        <div class="srow"><span>Reajuste acima do limite</span><strong>${num(5, 1)}% · parâmetro do projeto</strong></div>
        <div class="srow"><span>Execução</span><strong>realizado ÷ valor anual · alerta acima de 90%</strong></div>
        <div class="srow"><span>Realizado</span><strong>pedidos do mesmo fornecedor/categoria dentro da vigência</strong></div>
      </div>
      <p class="tiny muted" style="margin:10px 0 0">O vínculo é feito por fornecedor + categoria + janela de vigência, pois o fato de pedido não carrega <span class="mono">id_contrato</span>. Em produção, a chave contratual deve ser persistida no pedido para eliminar ambiguidade em contratos sobrepostos.</p>`)}
  </div>`;
}

/* ------------------------------- dados / ETL ------------------------------ */
function pageDados() {
  const rows = [
    ["dim_fornecedores", "Cadastro de fornecedores", store.dim.fornecedores.length, "id_fornecedor", "gold"],
    ["dim_itens", "Catálogo de itens e preço de referência", store.dim.itens.length, "id_item", "gold"],
    ["dim_categorias", "Hierarquia de categorias de compra", store.dim.categorias.length, "id_categoria", "gold"],
    ["dim_contratos", "Carteira contratual: vigência, valor e reajuste", store.dim.contratos.length, "id_contrato", "gold"],
    ["fato_pedidos", "Pedidos de compra (grão: item/pedido)", store.fato.pedidos.length, "id_pedido", "gold"],
    ["fato_cotacoes", "Propostas por requisição", store.fato.cotacoes.length, "id_requisicao", "gold"],
    ["fato_precos", "Série mensal de preços por item", store.fato.precos.length, "id_item + mes_ref", "gold"],
    ["fato_orcamento", "Orçamento e forecast por categoria/unidade", store.fato.orcamento.length, "mes_ref + categoria", "gold"],
  ];
  const mode = DATA_MODES[store.mode] || DATA_MODES.demo;
  const modeCards = Object.entries(DATA_MODES).map(([id, m]) => `
    <button class="mode-option ${store.mode === id ? "active" : ""}" data-action="set-mode" data-mode="${id}" aria-pressed="${store.mode === id}">
      <span class="mode-radio" aria-hidden="true"></span>
      <span><strong>${esc(m.label)}</strong><small>${esc(m.description)}</small></span>
    </button>`).join("");

  return `<div class="grid">
    ${card("col-12", "Ambiente de dados", "Escolha a origem exibida no painel · a preferência fica salva neste navegador",
      `<div class="mode-options">${modeCards}</div>
      <div class="mode-bar">
        <div class="tiny muted">Fonte ativa: <strong>${esc(mode.label)}</strong> · ${num(store.fato.pedidos.length)} pedidos · ${num(store.fato.cotacoes.length)} cotações · ${num(store.fato.precos.length)} preços</div>
        <div class="mode-actions">
          ${store.mode !== "empty" ? `<button class="btn btn-sm btn-danger-ghost" data-action="empty-data">Zerar fatos</button>` : ""}
          ${store.mode !== "demo" ? `<button class="btn btn-sm" data-action="restore-demo">Restaurar demo</button>` : ""}
        </div>
      </div>
      ${store.persistError ? `<div class="notice bad tiny">Não foi possível salvar as importações no navegador (cota do localStorage). Os dados continuam em memória até recarregar a página.</div>` : ""}
      <p class="tiny muted" style="margin:10px 0 0">A base vazia mantém ${num(store.dim.fornecedores.length)} fornecedores, ${num(store.dim.itens.length)} itens e os demais cadastros. Assim é possível importar pedidos sobre um cadastro válido e demonstrar o painel sem resultados.</p>`)}
    ${card("col-7", "Importar dados", "CSV com separador ; ou , · pedidos de compra no formato do modelo",
      `<div class="drop" id="drop">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
        <h4>Arraste o arquivo CSV aqui</h4>
        <p>ou <button class="btn btn-sm" data-action="pick-file" style="margin-top:6px">selecionar arquivo</button> · até 5 MB</p>
        <input type="file" id="file-input" accept=".csv,text/csv" class="sr-only" />
      </div>
      <div class="validation" id="validation" role="status" aria-live="polite"></div>
      <div class="hdivider"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-sm" data-action="download-template">Baixar modelo CSV</button>
        <button class="btn btn-sm btn-ghost" data-action="clear-uploads">Remover importações (${store.api ? uploadsCount() : storedUploadsCount()})</button>
      </div>
      <p class="tiny muted" style="margin:10px 0 0">A importação valida colunas obrigatórias, tipos, datas, chaves de dimensão e duplicidades. Registros com o mesmo <span class="mono">id_pedido</span> são atualizados; os demais são incluídos e recalculam todos os indicadores.</p>`)}
    ${card("col-5", "Qualidade e atualização", "Resumo da camada analítica",
      `<div class="stat-list">
        <div class="srow"><span>Competência mais recente</span><strong>${monthLabel(store.maxDate.slice(0, 7), true)}</strong></div>
        <div class="srow"><span>Pedidos na base</span><strong class="num">${num(store.fato.pedidos.length)}</strong></div>
        <div class="srow"><span>Cotações na base</span><strong class="num">${num(store.fato.cotacoes.length)}</strong></div>
        <div class="srow"><span>${store.api ? "Importações no servidor" : "Importações locais"}</span><strong class="num">${store.api ? uploadsCount() : storedUploadsCount()}</strong></div>
        <div class="srow"><span>Última carga</span><strong>${store.loadedAt ? store.loadedAt.toLocaleString("pt-BR") : "—"}</strong></div>
        <div class="srow"><span>Fonte de dados</span><strong>${esc(DATA_MODES[store.mode]?.label || store.mode)}</strong></div>
      </div>
      <div class="hdivider"></div>
      <div class="tiny muted">Pipeline: <span class="mono">extract → validate → transform → load (gold)</span>. O dataset versionado em <span class="mono">/data</span> é gerado de forma determinística (seed fixa), permitindo reprodutibilidade. A carga aceita <span class="mono">--mode incremental --since AAAA-MM-DD</span> com upsert e log em <span class="mono">dw.etl_run_log</span>.</div>`)}
    ${card("col-12", "Dicionário de dados", "Tabelas do modelo estrela expostas ao dashboard",
      table(
        [{ label: "Tabela" }, { label: "Descrição" }, { label: "Linhas", cls: "r" }, { label: "Chave" }, { label: "Camada" }],
        rows.map((r) => [`<td class="mono">${esc(r[0])}</td>`, `<td>${esc(r[1])}</td>`, tdR(num(r[2])), `<td class="mono tiny">${esc(r[3])}</td>`, `<td>${badge(r[4], "lilac")}</td>`])
      ))}
    ${card("col-12", "Exportações", "Arquivos gerados a partir dos filtros ativos",
      `<div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" data-action="export-xlsx">Excel (.xlsx) — 5 abas</button>
        <button class="btn" data-action="export-pdf">Relatório executivo (.pdf via impressão)</button>
        <button class="btn btn-ghost" data-action="export-pedidos">Pedidos filtrados (.csv)</button>
        <button class="btn btn-ghost" data-action="export-cotacoes">Cotações filtradas (.csv)</button>
      </div>
      <p class="tiny muted" style="margin:12px 0 0">O PDF é gerado pela engine de impressão do navegador com layout A4 dedicado (Salvar como PDF). O Excel é um arquivo OOXML nativo com formatação de moeda, percentual e filtros automáticos.</p>`)}
  </div>`;
}

/* --------------------------------- router -------------------------------- */
export function renderPage(page) {
  const c = buildContext();
  const html = page === "exec" ? pageExec(c)
    : page === "cotacoes" ? pageCotacoes(c)
      : page === "fornecedores" ? pageFornecedores(c)
        : page === "prazos" ? pagePrazos(c)
          : page === "precos" ? pagePrecos(c)
            : page === "contratos" ? pageContratos(c)
              : page === "admin" ? renderAdmin()
                : pageDados();
  const el = document.getElementById(`page-${page}`);
  el.innerHTML = html;
  const picker = el.querySelector("#supplier-picker");
  if (picker) picker.addEventListener("change", (e) => { ui.supplier = e.target.value; renderPage("fornecedores"); });
  const itemPicker = el.querySelector("#item-picker");
  if (itemPicker) itemPicker.addEventListener("change", (e) => { ui.item = e.target.value; renderPage("precos"); });
  const simInputs = ["sim-discount", "sim-coverage", "sim-volume"].map((id) => el.querySelector(`#${id}`)).filter(Boolean);
  if (simInputs.length) {
    const update = () => {
      const [discount, coverage, volume] = simInputs.map((input) => Number(input.value) || 0);
      const out = el.querySelector("#sim-output");
      if (out) out.innerHTML = simulationResult(c, discount / 100, coverage / 100, volume / 100).html;
    };
    simInputs.forEach((input) => input.addEventListener("input", update));
  }
  return c;
}

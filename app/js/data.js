/* Camada semântica: carga do dataset, filtros e agregações do modelo estrela. */
import { parseCSV, sum, avg, groupBy, hhi, clamp, quantile, weightedAvg } from "./util.js";

const FILES = {
  unidades: ["dim_unidades.csv", []],
  compradores: ["dim_compradores.csv", []],
  categorias: ["dim_categorias.csv", ["peso_spend", "drift_mensal", "lead_time_base_dias"]],
  itens: ["dim_itens.csv", ["preco_referencia"]],
  fornecedores: ["dim_fornecedores.csv", ["prazo_pagamento_dias", "rating_cadastral", "lead_time_medio_dias"]],
  contratos: ["dim_contratos.csv", ["valor_anual", "reajuste_pct"]],
  pedidos: ["fato_pedidos.csv", ["quantidade", "valor_unitario", "frete", "valor_total", "preco_referencia", "saving_valor", "tem_contrato", "atraso_dias", "qtd_recebida", "qtd_defeito", "otif", "nota_qualidade"]],
  cotacoes: ["fato_cotacoes.csv", ["quantidade", "preco_unitario", "frete", "valor_total", "prazo_entrega_dias", "prazo_pagamento_dias", "selecionada", "preco_referencia"]],
  precos: ["fato_precos.csv", ["preco_medio", "indice_categoria", "variacao_mm_pct"]],
  orcamento: ["fato_orcamento.csv", ["orcamento", "forecast"]],
};

/* ------------------------------- modos de dados --------------------------- */
export const DATA_MODES = {
  demo: {
    label: "Dataset demo",
    short: "demo",
    description: "Dataset versionado de 34 meses, com uploads locais aplicados.",
  },
  empty: {
    label: "Base vazia",
    short: "vazia",
    description: "Mantém dimensões e cadastros, sem pedidos, cotações, preços ou orçamento.",
  },
  uploads: {
    label: "Somente importações",
    short: "importações",
    description: "Usa apenas os pedidos importados neste navegador, sobre as dimensões da base.",
  },
};
const MODE_KEY = "meridian.dataMode.v1";
const UPLOAD_KEY = "meridian.uploads.v1";

function readMode() {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    return DATA_MODES[saved] ? saved : "demo";
  } catch { return "demo"; }
}

export function setDataMode(mode) {
  const next = DATA_MODES[mode] ? mode : "demo";
  store.mode = next;
  try { localStorage.setItem(MODE_KEY, next); } catch { /* noop */ }
  return next;
}

const todayISO = () => new Date().toISOString().slice(0, 10);
const monthEnd = (ym) => {
  if (!ym) return "";
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

function latestFactDate() {
  const dates = [
    ...store.fato.pedidos.map((p) => p.data_emissao),
    ...store.fato.cotacoes.map((q) => q.data_cotacao),
    ...store.fato.precos.map((p) => monthEnd(p.mes_ref)),
    ...store.fato.orcamento.map((o) => monthEnd(o.mes_ref)),
  ].filter(Boolean).sort();
  return dates[dates.length - 1] || todayISO();
}

function earliestFactDate() {
  const dates = [
    ...store.fato.pedidos.map((p) => p.data_emissao),
    ...store.fato.cotacoes.map((q) => q.data_cotacao),
    ...store.fato.precos.map((p) => `${p.mes_ref}-01`),
    ...store.fato.orcamento.map((o) => `${o.mes_ref}-01`),
  ].filter(Boolean).sort();
  if (dates.length) return dates[0];
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 3);
  return d.toISOString().slice(0, 10);
}

export const store = {
  dim: {}, fato: {}, filters: {},
  mode: readMode(),
  maxDate: todayISO(),
  minDate: todayISO(),
  source: "gold",
  loadedAt: null,
  persistError: false,
  extra: { pedidos: [] },
};

function toObjects(text, numeric) {
  const { header, rows } = parseCSV(text);
  const numSet = new Set(numeric);
  return rows.map((r) => {
    const o = {};
    header.forEach((h, i) => {
      const raw = (r[i] ?? "").trim();
      o[h] = numSet.has(h) ? (raw === "" ? null : Number(raw)) : raw;
    });
    return o;
  });
}

export async function loadData(mode = store.mode) {
  const nextMode = DATA_MODES[mode] ? mode : "demo";
  const entries = Object.entries(FILES);
  const texts = await Promise.all(entries.map(async ([key, [file]]) => {
    const res = await fetch(`../data/${file}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Falha ao carregar ${file} (${res.status})`);
    return [key, await res.text()];
  }));
  const raw = {};
  for (const [key, text] of texts) raw[key] = toObjects(text, FILES[key][1]);

  store.dim = {
    unidades: raw.unidades,
    compradores: raw.compradores,
    categorias: raw.categorias,
    itens: raw.itens,
    fornecedores: raw.fornecedores,
    contratos: raw.contratos,
  };

  const includeDemoFacts = nextMode === "demo";
  const includeUploads = nextMode === "demo" || nextMode === "uploads";
  store.fato = includeDemoFacts
    ? {
      pedidos: raw.pedidos,
      cotacoes: raw.cotacoes,
      precos: raw.precos,
      orcamento: raw.orcamento,
    }
    : { pedidos: [], cotacoes: [], precos: [], orcamento: [] };

  store.persistError = false;
  if (includeUploads) {
    const saved = restoreUploads();
    if (saved.length) store.fato.pedidos.push(...saved);
  }

  setDataMode(nextMode);
  store.maxDate = latestFactDate();
  store.minDate = earliestFactDate();
  store.loadedAt = new Date();
  buildIndex();
  return store;
}

export function buildIndex() {
  const fById = new Map(store.dim.fornecedores.map((f) => [f.id_fornecedor, f]));
  const cById = new Map(store.dim.categorias.map((c) => [c.id_categoria, c]));
  const iById = new Map(store.dim.itens.map((i) => [i.id_item, i]));
  const uById = new Map(store.dim.unidades.map((u) => [u.id_unidade, u]));
  const kById = new Map(store.dim.compradores.map((c) => [c.id_comprador, c]));
  store.idx = { fById, cById, iById, uById, kById };

  for (const p of store.fato.pedidos) {
    p.fornecedor = fById.get(p.id_fornecedor);
    p.categoria = cById.get(p.id_categoria);
    p.item = iById.get(p.id_item);
    p.unidade = uById.get(p.id_unidade);
    p.comprador = kById.get(p.id_comprador);
    p.mes = p.data_emissao?.slice(0, 7) || p.mes_ref;
    p.ano = p.mes?.slice(0, 4);
  }
  for (const q of store.fato.cotacoes) {
    q.fornecedor = fById.get(q.id_fornecedor);
    q.categoria = cById.get(q.id_categoria);
    q.item = iById.get(q.id_item);
    q.mes = q.data_cotacao?.slice(0, 7);
  }
  for (const c of store.dim.contratos) c.fornecedor = fById.get(c.id_fornecedor);
}

/* ------------------------------ filtros ---------------------------------- */
export function defaultFilters() {
  return { period: "12", from: "", to: "", unidade: "", categoria: "", comprador: "", fornecedor: "", status: "" };
}

export function periodBounds(period, maxDate, custom = {}, minDate = "2020-01-01") {
  const maxYm = maxDate.slice(0, 7);
  const [y, m] = maxYm.split("-").map(Number);
  const endOfMonth = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
  const shift = (n) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    return d.toISOString().slice(0, 7);
  };
  if (period === "all") return { from: minDate || "2020-01-01", to: endOfMonth(y, m), months: null };
  if (period === "ytd") return { from: `${y}-01-01`, to: endOfMonth(y, m), months: m };
  if (period === "custom") return { from: custom.from || `${shift(-11)}-01`, to: custom.to || endOfMonth(y, m), months: null };
  const n = Number(period) || 12;
  return { from: `${shift(-(n - 1))}-01`, to: endOfMonth(y, m), months: n };
}

export function prevBounds(from, to) {
  const [fy, fm] = from.slice(0, 7).split("-").map(Number);
  const [ty, tm] = to.slice(0, 7).split("-").map(Number);
  const n = (ty - fy) * 12 + (tm - fm) + 1;
  const pf = new Date(Date.UTC(fy, fm - 1 - n, 1)).toISOString().slice(0, 7);
  const pt = new Date(Date.UTC(fy, fm - 1, 0)).toISOString().slice(0, 10);
  return { from: `${pf}-01`, to: pt };
}

export function applyFilters(pedidos, cotacoes, f) {
  const inRange = (d) => d && d >= f.from && d <= f.to;
  const ped = pedidos.filter((p) =>
    inRange(p.data_emissao) &&
    (!f.unidade || p.id_unidade === f.unidade) &&
    (!f.categoria || p.id_categoria === f.categoria) &&
    (!f.comprador || p.id_comprador === f.comprador) &&
    (!f.fornecedor || p.id_fornecedor === f.fornecedor) &&
    (!f.status || p.status === f.status)
  );

  // Cotações não têm unidade/comprador/status próprios: herdam do pedido
  // gerado pela requisição quando o filtro exige esse contexto.
  const reqMeta = new Map();
  for (const p of pedidos) {
    if (!p.id_requisicao) continue;
    const prev = reqMeta.get(p.id_requisicao) || {};
    reqMeta.set(p.id_requisicao, {
      id_unidade: prev.id_unidade || p.id_unidade,
      id_comprador: prev.id_comprador || p.id_comprador,
      status: prev.status || p.status,
    });
  }
  const cot = cotacoes.filter((q) => {
    if (!inRange(q.data_cotacao)) return false;
    if (f.categoria && q.id_categoria !== f.categoria) return false;
    if (f.fornecedor && q.id_fornecedor !== f.fornecedor) return false;
    const meta = reqMeta.get(q.id_requisicao);
    if (f.unidade && meta?.id_unidade !== f.unidade) return false;
    if (f.comprador && meta?.id_comprador !== f.comprador) return false;
    if (f.status && meta?.status !== f.status) return false;
    return true;
  });
  return { pedidos: ped, cotacoes: cot };
}

export function monthsBetween(from, to) {
  const out = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const [ey, em] = to.slice(0, 7).split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

/* ------------------------------ agregações ------------------------------- */
export const validSpend = (p) => p.status !== "Cancelado";
export const delivered = (p) => p.data_entrega_real && p.status !== "Cancelado";

export function kpis(pedidos, prevPedidos, orcamento, months, f) {
  const cur = pedidos.filter(validSpend);
  const prev = prevPedidos.filter(validSpend);
  const spend = sum(cur, (p) => p.valor_total);
  const spendPrev = sum(prev, (p) => p.valor_total);
  const saving = sum(cur, (p) => p.saving_valor);
  const savingPrev = sum(prev, (p) => p.saving_valor);
  const budgetRows = orcamento.filter((o) =>
    months.includes(o.mes_ref) &&
    (!f.categoria || o.id_categoria === f.categoria) &&
    (!f.unidade || o.id_unidade === f.unidade)
  );
  const budget = sum(budgetRows, (o) => o.orcamento);
  const del = cur.filter(delivered);
  const otif = del.length ? sum(del, (p) => p.otif) / del.length : 0;
  const late = del.filter((p) => (p.atraso_dias || 0) > 0);
  const delays = del.map((p) => p.atraso_dias || 0);
  const lead = del.map((p) => Math.max(0, (new Date(p.data_entrega_real) - new Date(p.data_emissao)) / 864e5));
  const suppliers = [...groupBy(cur, (p) => p.id_fornecedor).entries()];
  const shares = suppliers.map(([, rows]) => sum(rows, (p) => p.valor_total));
  const sortedShares = [...shares].sort((a, b) => b - a);
  const contractSpend = sum(cur.filter((p) => p.tem_contrato === 1), (p) => p.valor_total);
  const received = sum(del, (p) => p.qtd_recebida || 0);
  const defects = sum(del, (p) => p.qtd_defeito || 0);
  const open = cur.filter((p) => ["Em trânsito", "Parcial", "Atrasado"].includes(p.status));
  const quotes = groupBy(cur, (p) => p.id_requisicao);
  return {
    spend, spendPrev, spendDelta: spendPrev ? spend / spendPrev - 1 : null,
    saving, savingPrev, savingDelta: savingPrev ? saving / savingPrev - 1 : null,
    savingRate: spend ? saving / spend : 0,
    savingRatePrev: spendPrev ? savingPrev / spendPrev : 0,
    budget, adherence: budget ? spend / budget : null,
    otif, otifPrev: prev.filter(delivered).length ? sum(prev.filter(delivered), (p) => p.otif) / prev.filter(delivered).length : 0,
    lateShare: del.length ? late.length / del.length : 0,
    avgDelay: avg(delays),
    p90Delay: quantile(delays, 0.9),
    leadTime: avg(lead),
    leadTimePrev: avg(prev.filter(delivered).map((p) => Math.max(0, (new Date(p.data_entrega_real) - new Date(p.data_emissao)) / 864e5))),
    suppliersCount: suppliers.length,
    hhi: hhi(shares),
    top5Share: sum(sortedShares.slice(0, 5)) / (spend || 1),
    contractShare: spend ? contractSpend / spend : 0,
    defectRate: received ? defects / received : 0,
    openCount: open.length,
    openValue: sum(open, (p) => p.valor_total),
    orders: cur.length,
    ticket: cur.length ? spend / cur.length : 0,
    reqCount: quotes.size,
    cancelRate: pedidos.length ? pedidos.filter((p) => p.status === "Cancelado").length / pedidos.length : 0,
  };
}

export function spendByMonth(pedidos, months, extra = () => ({})) {
  const map = new Map(months.map((m) => [m, { mes: m, valor: 0, saving: 0, pedidos: 0, ...extra(m) }]));
  for (const p of pedidos) {
    if (!validSpend(p)) continue;
    const rec = map.get(p.mes);
    if (!rec) continue;
    rec.valor += p.valor_total || 0;
    rec.saving += p.saving_valor || 0;
    rec.pedidos++;
  }
  return [...map.values()];
}

export function budgetByMonth(orcamento, months, f) {
  const map = new Map(months.map((m) => [m, 0]));
  for (const o of orcamento) {
    if (!map.has(o.mes_ref)) continue;
    if (f.categoria && o.id_categoria !== f.categoria) continue;
    if (f.unidade && o.id_unidade !== f.unidade) continue;
    map.set(o.mes_ref, map.get(o.mes_ref) + (o.orcamento || 0));
  }
  return [...map.values()];
}

export function byCategory(pedidos) {
  const g = groupBy(pedidos.filter(validSpend), (p) => p.id_categoria);
  return [...g.entries()].map(([id, rows]) => {
    const del = rows.filter(delivered);
    const saving = sum(rows, (p) => p.saving_valor);
    const spend = sum(rows, (p) => p.valor_total);
    return {
      id,
      nome: rows[0]?.categoria?.categoria || id,
      grupo: rows[0]?.categoria?.grupo || "—",
      spend, saving, savingRate: spend ? saving / spend : 0,
      orders: rows.length,
      otif: del.length ? sum(del, (p) => p.otif) / del.length : null,
      delay: avg(del, (p) => p.atraso_dias || 0),
      lead: avg(del, (p) => Math.max(0, (new Date(p.data_entrega_real) - new Date(p.data_emissao)) / 864e5)),
      suppliers: new Set(rows.map((p) => p.id_fornecedor)).size,
      share: 0,
    };
  }).map((c, _, arr) => ({ ...c, share: c.spend / (sum(arr, (x) => x.spend) || 1) }))
    .sort((a, b) => b.spend - a.spend);
}

export function supplierScorecards(pedidos, cotacoes) {
  const byF = groupBy(pedidos.filter(validSpend), (p) => p.id_fornecedor);
  const quotesByF = groupBy(cotacoes.filter((q) => q.selecionada === 1), (q) => q.id_fornecedor);
  const out = [];
  for (const [id, rows] of byF) {
    const f = rows[0]?.fornecedor || { razon_social: id };
    const del = rows.filter(delivered);
    const spend = sum(rows, (p) => p.valor_total);
    const saving = sum(rows, (p) => p.saving_valor);
    const otif = del.length ? sum(del, (p) => p.otif) / del.length : 0;
    const q = quotesByF.get(id) || [];
    const competitiveness = avg(q.filter((x) => x.preco_referencia).map((x) => 1 - x.preco_unitario / x.preco_referencia));
    const rec = sum(del, (p) => p.qtd_recebida || 0);
    const def = rec ? sum(del, (p) => p.qtd_defeito || 0) / rec : 0;
    const rating = (f.rating_cadastral || 70) / 100;
    const prazoScore = clamp(otif, 0, 1);
    const qualidade = clamp(1 - def * 25, 0, 1);
    const precoScore = clamp(0.5 + competitiveness * 2.4, 0, 1);
    const conformidade = clamp(rating * 0.7 + (rows.filter((p) => p.tem_contrato === 1).length / (rows.length || 1)) * 0.3, 0, 1);
    const score = (prazoScore * 0.35 + qualidade * 0.25 + precoScore * 0.25 + conformidade * 0.15) * 100;
    out.push({
      id, nome: f.razao_social || id, categoria: rows[0]?.categoria?.categoria || "—",
      uf: f.uf, porte: f.porte, risco: f.risco, rating: f.rating_cadastral,
      status: f.status, spend, saving, savingRate: spend ? saving / spend : 0,
      orders: rows.length, otif, delay: avg(del, (p) => p.atraso_dias || 0),
      lead: avg(del, (p) => Math.max(0, (new Date(p.data_entrega_real) - new Date(p.data_emissao)) / 864e5)),
      defectRate: def, score, prazoScore, qualidade, precoScore, conformidade,
      contractShare: rows.filter((p) => p.tem_contrato === 1).length / rows.length,
      lastOrder: rows.reduce((m, p) => (p.data_emissao > m ? p.data_emissao : m), ""),
    });
  }
  return out.sort((a, b) => b.spend - a.spend);
}

export function priceStats(precos, pedidos, f) {
  const rows = precos.filter((p) => !f.categoria || p.id_categoria === f.categoria);
  const byItem = groupBy(rows, (p) => p.id_item);
  const spendByItem = groupBy(pedidos.filter(validSpend), (p) => p.id_item);
  const months = [...new Set(rows.map((p) => p.mes_ref))].sort();
  const last = months[months.length - 1];
  const target12 = months[Math.max(0, months.length - 13)];
  const items = [];
  for (const [idItem, series] of byItem) {
    const sorted = series.slice().sort((a, b) => a.mes_ref.localeCompare(b.mes_ref));
    const cur = sorted.find((x) => x.mes_ref === last)?.preco_medio;
    const base = sorted.find((x) => x.mes_ref === target12)?.preco_medio;
    const prev = sorted[sorted.length - 2]?.preco_medio;
    const spend = sum(spendByItem.get(idItem) || [], (p) => p.valor_total);
    items.push({
      id: idItem, descricao: sorted[0]?.descricao_item || idItem, categoria: sorted[0]?.id_categoria,
      preco: cur, variacao: base ? cur / base - 1 : null, variacaoMes: prev ? cur / prev - 1 : null,
      spend, serie: sorted.map((s) => ({ mes: s.mes_ref, preco: s.preco_medio })),
      indice: sorted[sorted.length - 1]?.indice_categoria || 1,
      variacaoMm: sorted[sorted.length - 1]?.variacao_mm_pct || 0,
    });
  }
  const weighted = weightedAvg(
    items.filter((i) => i.variacao != null && i.spend > 0),
    (i) => i.variacao, (i) => i.spend
  );
  const byCat = groupBy(items, (i) => i.categoria);
  const categorias = [...byCat.entries()].map(([id, arr]) => ({
    id, nome: store.idx?.cById.get(id)?.categoria || id,
    variacao: weightedAvg(arr.filter((i) => i.variacao != null), (i) => i.variacao, (i) => i.spend || 1),
    spend: sum(arr, (i) => i.spend), itens: arr.length,
  })).sort((a, b) => b.variacao - a.variacao);
  return {
    items: items.sort((a, b) => b.spend - a.spend),
    variacaoGeral: weighted,
    categorias,
    months,
    last,
    altas: items.filter((i) => i.variacao > 0.03).length,
    baixas: items.filter((i) => i.variacao < -0.03).length,
  };
}

export function priceIndexSeries(precos, months, f) {
  const rows = precos.filter((p) => !f.categoria || p.id_categoria === f.categoria);
  const base = rows.filter((p) => p.mes_ref === months[0]).reduce((s, p) => s + p.indice_categoria, 0) / (rows.filter((p) => p.mes_ref === months[0]).length || 1);
  const byMonth = groupBy(rows, (p) => p.mes_ref);
  return months.map((m) => {
    const arr = byMonth.get(m) || [];
    const idx = arr.length ? avg(arr, (p) => p.indice_categoria) : 1;
    return { mes: m, indice: (idx / (base || 1)) * 100 };
  });
}

export function quoteStats(cotacoes, pedidos) {
  const byReq = groupBy(cotacoes, (q) => q.id_requisicao);
  const reqs = [...byReq.values()];
  const competitive = reqs.filter((r) => r.length >= 3).length;
  const selected = cotacoes.filter((q) => q.selecionada === 1);
  const savings = selected.map((q) => q.quantidade * (q.preco_referencia - q.preco_unitario));
  const totalRef = sum(selected, (q) => q.quantidade * q.preco_referencia);
  const best = reqs.filter((r) => {
    const win = r.find((q) => q.selecionada === 1);
    if (!win) return false;
    const min = Math.min(...r.map((q) => q.valor_total));
    return Math.abs(win.valor_total - min) < 0.01;
  }).length;
  return {
    requisicoes: reqs.length,
    cotacoes: cotacoes.length,
    perReq: cotacoes.length / (reqs.length || 1),
    competitiveShare: competitive / (reqs.length || 1),
    selected: selected.length,
    saving: sum(savings),
    savingRate: totalRef ? sum(savings) / totalRef : 0,
    bestPriceShare: best / (reqs.length || 1),
    avgSpread: avg(reqs.filter((r) => r.length > 1).map((r) => {
      const v = r.map((q) => q.valor_total);
      const mn = Math.min(...v), mx = Math.max(...v);
      return mx ? (mx - mn) / mx : 0;
    })),
    pedidos: pedidos.length,
  };
}

/* ----------------------------- uploads locais ----------------------------- */

function restoreUploads() {
  try {
    const raw = localStorage.getItem(UPLOAD_KEY);
    if (!raw) return [];
    const rows = JSON.parse(raw);
    return Array.isArray(rows) ? rows.map((r) => ({ ...r, __upload: true })) : [];
  } catch { return []; }
}

/** Remove objetos de dimensão e campos derivados antes de persistir. */
function persistableOrder(p) {
  const {
    fornecedor, categoria, item, unidade, comprador,
    mes, ano, __upload, ...rest
  } = p;
  return rest;
}

function persistUploads() {
  try {
    const rows = store.fato.pedidos
      .filter((p) => p.__upload)
      .slice(-4000)
      .map(persistableOrder);
    localStorage.setItem(UPLOAD_KEY, JSON.stringify(rows));
    store.persistError = false;
    return true;
  } catch {
    // Cota excedida: mantém em memória e informa a interface.
    store.persistError = true;
    return false;
  }
}

/** Substitui por id_pedido ou acrescenta; devolve {novos, atualizados}. */
export function addUploadedOrders(rows) {
  let novos = 0, atualizados = 0;
  for (const row of rows) {
    const p = { ...row, __upload: true };
    const i = store.fato.pedidos.findIndex((x) => x.id_pedido === p.id_pedido);
    if (i >= 0) { store.fato.pedidos[i] = p; atualizados++; }
    else { store.fato.pedidos.push(p); novos++; }
  }
  if (rows.length) {
    store.maxDate = latestFactDate();
    store.minDate = earliestFactDate();
    buildIndex();
    persistUploads();
    // Base vazia + importação passa a ser uma base de importações.
    if (store.mode === "empty") setDataMode("uploads");
  }
  return { novos, atualizados };
}

export function clearUploads() {
  store.fato.pedidos = store.fato.pedidos.filter((p) => !p.__upload);
  try { localStorage.removeItem(UPLOAD_KEY); } catch { /* noop */ }
  store.persistError = false;
  store.maxDate = latestFactDate();
  store.minDate = earliestFactDate();
  buildIndex();
  if (store.mode === "uploads") setDataMode("empty");
}

export function uploadsCount() {
  return store.fato.pedidos.filter((p) => p.__upload).length;
}

/** Quantidade de importações salvas, mesmo quando o modo atual não as carrega. */
export function storedUploadsCount() {
  try {
    const raw = localStorage.getItem(UPLOAD_KEY);
    if (!raw) return 0;
    const rows = JSON.parse(raw);
    return Array.isArray(rows) ? rows.length : 0;
  } catch { return 0; }
}

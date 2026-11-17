/* Regras canônicas de KPI — sem DOM, sem estado global.
 *
 * Este módulo é a fonte única das regras de negócio usadas pelo painel,
 * pelos testes de regressão e pela reconciliação com SQL/DAX. Alterações
 * aqui exigem atualização de docs/03-kpis-e-analises.md, sql/02_views_kpi.sql
 * e dax/medidas.dax, além dos testes em tests/.
 */

export const CANCELED = "Cancelado";
export const OPEN_STATUSES = ["Em trânsito", "Parcial", "Atrasado"];
export const DELIVERED_STATUSES = ["Entregue", "Parcial", "Atrasado"];
export const SCORE_WEIGHTS = Object.freeze({ prazo: 0.35, qualidade: 0.25, preco: 0.25, conformidade: 0.15 });
export const SCORE_MIN_PILLARS = 3;
export const RENEGOTIATION_DEFAULT = Object.freeze({ discountPct: 0.03, coveragePct: 0.6, volumeDeltaPct: 0 });

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const round = (v, digits = 2) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  // Deslocamento decimal + epsilon evita o caso 73,95 → 73,9 causado por binário.
  const adjusted = n + Math.sign(n) * 1e-12;
  return Number(`${Math.round(Number(`${adjusted}e${digits}`))}e-${digits}`);
};
export const sum = (rows, fn = (x) => x) => rows.reduce((acc, row) => acc + num(fn(row)), 0);
export const avg = (rows, fn = (x) => x) => (rows.length ? sum(rows, fn) / rows.length : 0);

export const isValidSpend = (p) => p?.status !== CANCELED;
export const isDelivered = (p) => Boolean(p?.data_entrega_real) && isValidSpend(p);
export const isOpen = (p) => OPEN_STATUSES.includes(p?.status) && isValidSpend(p);

/** Regra canônica do OTIF: prazo + completude + qualidade. */
export function computeOtif(p) {
  return p?.status === "Entregue"
    && num(p.atraso_dias) === 0
    && num(p.qtd_recebida) >= num(p.quantidade)
    && num(p.qtd_defeito) === 0
    ? 1
    : 0;
}

/** HHI 0–10.000 a partir dos valores de spend por fornecedor. */
export function hhi(values) {
  const total = values.reduce((acc, v) => acc + num(v), 0);
  if (!total) return 0;
  return values.reduce((acc, v) => acc + (num(v) / total) ** 2, 0) * 10000;
}

/** Participação dos N maiores valores. */
export function topNShare(values, n = 5) {
  const total = values.reduce((acc, v) => acc + num(v), 0);
  if (!total) return 0;
  const top = [...values].map(num).sort((a, b) => b - a).slice(0, n);
  return top.reduce((acc, v) => acc + v, 0) / total;
}

/** Média ponderada tolerante a pesos zero/negativos. */
export function weightedAverage(rows, valueFn, weightFn) {
  let acc = 0;
  let weight = 0;
  for (const row of rows) {
    const w = Math.max(0, num(weightFn(row)));
    acc += num(valueFn(row)) * w;
    weight += w;
  }
  return weight ? acc / weight : 0;
}

/**
 * Score composto do fornecedor (0–100).
 *
 * Pesos: prazo 35%, qualidade 25%, preço 25%, conformidade 15%.
 * Pilares sem dados (sem entregas, sem quantidade recebida ou sem proposta
 * vencedora) são excluídos e os pesos restantes são renormalizados. O score
 * só é publicado com pelo menos 3 pilares disponíveis; caso contrário é null
 * (“histórico insuficiente”), evitando penalizar ou premiar fornecedor novo.
 */
export function supplierScore({
  deliveries = 0,
  otif = null,
  received = 0,
  defects = 0,
  quotes = 0,
  competitiveness = null,
  rating = 0,
  contractSpend = 0,
  spend = 0,
} = {}) {
  const pillars = [];

  if (num(deliveries) > 0 && otif != null && Number.isFinite(Number(otif))) {
    pillars.push({ key: "prazo", label: "Prazo (OTIF)", weight: SCORE_WEIGHTS.prazo, value: clamp(num(otif), 0, 1) });
  }
  if (num(received) > 0) {
    pillars.push({
      key: "qualidade",
      label: "Qualidade",
      weight: SCORE_WEIGHTS.qualidade,
      value: clamp(1 - (num(defects) / num(received)) * 25, 0, 1),
    });
  }
  if (num(quotes) > 0 && competitiveness != null && Number.isFinite(Number(competitiveness))) {
    pillars.push({
      key: "preco",
      label: "Competitividade",
      weight: SCORE_WEIGHTS.preco,
      value: clamp(0.5 + num(competitiveness) * 2.4, 0, 1),
    });
  }
  const contractShare = num(spend) ? num(contractSpend) / num(spend) : 0;
  pillars.push({
    key: "conformidade",
    label: "Conformidade",
    weight: SCORE_WEIGHTS.conformidade,
    value: clamp((num(rating) / 100) * 0.7 + contractShare * 0.3, 0, 1),
  });

  const availableWeight = pillars.reduce((acc, p) => acc + p.weight, 0);
  const raw = availableWeight
    ? pillars.reduce((acc, p) => acc + p.value * p.weight, 0) / availableWeight
    : 0;
  const score = pillars.length >= SCORE_MIN_PILLARS ? round(raw * 100, 1) : null;

  const byKey = Object.fromEntries(pillars.map((p) => [p.key, round(p.value, 4)]));
  return {
    ...byKey,
    prazoScore: byKey.prazo ?? null,
    qualidade: byKey.qualidade ?? null,
    precoScore: byKey.preco ?? null,
    conformidade: byKey.conformidade ?? null,
    score,
    pillars: pillars.length,
    availableWeight: round(availableWeight, 4),
    missing: ["prazo", "qualidade", "preco"].filter((k) => !(k in byKey)),
  };
}

export function supplierClassification(score) {
  if (score == null) return "Sem histórico suficiente";
  if (score >= 85) return "Estratégico";
  if (score >= 70) return "Preferencial";
  if (score >= 55) return "Aprovado";
  return "Em desenvolvimento";
}

/* ----------------------------- contratos -------------------------------- */

export const CONTRACT_ALERT_DAYS = 90;
export const CONTRACT_REAJUSTE_LIMIT = 5.0;

export function daysBetween(fromISO, toISO) {
  if (!fromISO || !toISO) return null;
  const from = Date.parse(`${fromISO}T00:00:00Z`);
  const to = Date.parse(`${toISO}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / 864e5);
}

export function contractSituation(contract, asOf, alertDays = CONTRACT_ALERT_DAYS) {
  if (contract.status === "Suspenso") return "Suspenso";
  if (contract.status === "Encerrado" && contract.data_fim >= asOf) return "Encerrado";
  if (contract.data_inicio > asOf) return "Futuro";
  if (contract.data_fim < asOf) return "Vencido";
  if (daysBetween(asOf, contract.data_fim) <= alertDays) return "A vencer";
  return "Vigente";
}

/** Pedidos elegíveis para um contrato: mesmo fornecedor/categoria e vigência. */
function contractOrders(contract, orders) {
  return orders.filter((p) =>
    isValidSpend(p)
    && p.id_fornecedor === contract.id_fornecedor
    && p.id_categoria === contract.id_categoria
    && p.data_emissao >= contract.data_inicio
    && p.data_emissao <= contract.data_fim
  );
}

export function contractPortfolio(contracts = [], orders = [], asOf, options = {}) {
  const alertDays = Number.isFinite(Number(options.alertDays)) ? Number(options.alertDays) : CONTRACT_ALERT_DAYS;
  const reajusteLimit = Number.isFinite(Number(options.reajusteLimit)) ? Number(options.reajusteLimit) : CONTRACT_REAJUSTE_LIMIT;
  const rows = contracts.map((c) => {
    const docs = contractOrders(c, orders);
    const realizado = sum(docs, (p) => p.valor_total);
    const ativos = orders.filter((p) =>
      isOpen(p)
      && p.id_fornecedor === c.id_fornecedor
      && p.id_categoria === c.id_categoria
      && p.data_emissao > c.data_fim
    );
    const situacao = contractSituation(c, asOf, alertDays);
    const dias = daysBetween(asOf, c.data_fim);
    const execucao = num(c.valor_anual) ? realizado / num(c.valor_anual) : null;
    const alertas = [];
    if (situacao === "Vencido" && ativos.length) {
      alertas.push({ level: "critical", code: "VENCIDO_COM_PEDIDO", message: `${ativos.length} pedido(s) ativo(s) após o vencimento` });
    } else if (situacao === "Vencido") {
      alertas.push({ level: "warn", code: "VENCIDO", message: "Contrato vencido sem pedidos ativos" });
    }
    if (situacao === "A vencer") alertas.push({ level: "warn", code: "A_VENCER", message: `Vence em ${dias} dias` });
    if (num(c.reajuste_pct) > reajusteLimit) {
      alertas.push({ level: "warn", code: "REAJUSTE", message: `Reajuste de ${round(c.reajuste_pct, 2)}% acima do limite de ${reajusteLimit}%` });
    }
    if (execucao != null && execucao > 0.9) {
      alertas.push({ level: execucao > 1 ? "critical" : "info", code: "EXECUCAO", message: `Execução de ${round(execucao * 100, 1)}% do valor anual` });
    }
    return {
      ...c,
      situacao,
      dias_para_vencimento: dias,
      realizado,
      saldo: num(c.valor_anual) - realizado,
      execucao,
      pedidos: docs.length,
      pedidos_ativos_pos_vencimento: ativos.length,
      exposicao: sum(ativos, (p) => p.valor_total),
      alertas,
    };
  });

  const alertas = rows.flatMap((r) => r.alertas.map((a) => ({ ...a, contrato: r })))
    .sort((a, b) => (a.level === "critical" ? -1 : 1) - (b.level === "critical" ? -1 : 1));

  return {
    rows: rows.sort((a, b) => {
      const order = { Vencido: 0, "A vencer": 1, Vigente: 2, Futuro: 3, Encerrado: 4, Suspenso: 5 };
      return (order[a.situacao] ?? 9) - (order[b.situacao] ?? 9) || b.valor_anual - a.valor_anual;
    }),
    alertas,
    totals: {
      contratos: rows.length,
      vigentes: rows.filter((r) => r.situacao === "Vigente").length,
      aVencer90: rows.filter((r) => r.situacao === "A vencer").length,
      vencidos: rows.filter((r) => r.situacao === "Vencido").length,
      vencidosComPedidoAtivo: rows.filter((r) => r.situacao === "Vencido" && r.pedidos_ativos_pos_vencimento > 0).length,
      valorContratado: sum(rows, (r) => r.valor_anual),
      realizado: sum(rows, (r) => r.realizado),
      saldo: sum(rows, (r) => r.saldo),
      exposicao: sum(rows, (r) => r.exposicao),
      reajusteMedio: avg(rows, (r) => r.reajuste_pct),
      alertasCriticos: alertas.filter((a) => a.level === "critical").length,
    },
  };
}

/* ------------------------------ previsão -------------------------------- */

export function addMonths(ym, n) {
  const [y, m] = String(ym).split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function linearRegression(values) {
  const points = values.map((v, i) => [i, num(v)]).filter(([, v]) => Number.isFinite(v));
  if (points.length < 2) return { slope: 0, intercept: points[0]?.[1] ?? 0, r2: 0 };
  const mx = avg(points, (p) => p[0]);
  const my = avg(points, (p) => p[1]);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of points) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  const slope = sxx ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  const r2 = sxx && syy ? (sxy * sxy) / (sxx * syy) : 0;
  return { slope, intercept, r2 };
}

/**
 * Projeção de spend para os próximos meses por regressão linear sobre os
 * últimos `window` meses observados. A banda é a dispersão residual (1,5 σ);
 * é uma previsão de tendência, não um modelo sazonal.
 */
export function forecastSpend(series = [], { horizon = 3, window = 6, budgetSeries = [] } = {}) {
  const actual = series.map((x) => ({ mes: x.mes, valor: num(x.valor) }));
  const usable = actual.filter((x) => x.valor > 0).slice(-window);
  const { slope, intercept, r2 } = linearRegression(usable.map((x) => x.valor));
  const residuals = usable.map((x, i) => x.valor - (intercept + slope * i));
  const sigma = residuals.length > 1
    ? Math.sqrt(residuals.reduce((acc, r) => acc + r * r, 0) / (residuals.length - 2 || 1))
    : 0;
  const base = usable.length;
  const lastMonth = actual[actual.length - 1]?.mes || new Date().toISOString().slice(0, 7);
  const budgetAvg = avg(budgetSeries.slice(-3));

  const months = Array.from({ length: horizon }, (_, i) => {
    const mes = addMonths(lastMonth, i + 1);
    const index = base + i;
    const valor = Math.max(0, intercept + slope * index);
    return {
      mes,
      valor,
      low: Math.max(0, valor - 1.5 * sigma),
      high: valor + 1.5 * sigma,
      budget: budgetAvg,
      // Sem orçamento futuro no dataset: a referência é a média dos últimos 3 meses.
      budgetReference: budgetAvg,
    };
  });

  return {
    months,
    slope,
    r2: Math.max(0, Math.min(1, r2)),
    sigma,
    total: sum(months, (m) => m.valor),
    budgetReference: budgetAvg,
    history: usable,
    method: "regressão linear (últimos 6 meses) com banda de 1,5 σ",
  };
}

/* ------------------------- simulação de negociação ----------------------- */

export function simulateRenegotiation({ spend = 0, saving = 0, discountPct = 0, coveragePct = 0, volumeDeltaPct = 0 } = {}) {
  const volume = clamp(num(volumeDeltaPct), -0.99, 5);
  const eligible = num(spend) * clamp(num(coveragePct), 0, 1) * (1 + volume);
  const incremental = eligible * clamp(num(discountPct), 0, 1);
  const currentOnEligible = num(spend) ? num(saving) * (eligible / num(spend)) : 0;
  const newSaving = currentOnEligible + incremental;
  const newSpend = Math.max(0, num(spend) * (1 + volume) - incremental);
  return {
    eligible,
    incremental,
    currentOnEligible,
    newSaving,
    newSpend,
    newSavingRate: newSpend ? newSaving / newSpend : 0,
    discountPct: clamp(num(discountPct), 0, 1),
    coveragePct: clamp(num(coveragePct), 0, 1),
    volumeDeltaPct: volume,
  };
}

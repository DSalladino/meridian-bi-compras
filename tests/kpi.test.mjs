import test from "node:test";
import assert from "node:assert/strict";
import {
  computeOtif, isValidSpend, isDelivered, topNShare, hhi,
  supplierScore, supplierClassification, contractPortfolio,
  forecastSpend, simulateRenegotiation, linearRegression, addMonths,
} from "../app/js/kpi.js";
import { loadDataset } from "../scripts/lib/dataset.mjs";

test("OTIF: somente Entregue, no prazo, completo e sem defeito", () => {
  const base = { status: "Entregue", atraso_dias: 0, quantidade: 10, qtd_recebida: 10, qtd_defeito: 0 };
  assert.equal(computeOtif(base), 1);
  assert.equal(computeOtif({ ...base, status: "Parcial" }), 0);
  assert.equal(computeOtif({ ...base, atraso_dias: 1 }), 0);
  assert.equal(computeOtif({ ...base, qtd_recebida: 9 }), 0);
  assert.equal(computeOtif({ ...base, qtd_defeito: 1 }), 0);
  assert.equal(computeOtif({ ...base, status: "Cancelado" }), 0);
});

test("cancelado não é spend nem entrega", () => {
  const p = { status: "Cancelado", data_entrega_real: "2026-01-01", valor_total: 100 };
  assert.equal(isValidSpend(p), false);
  assert.equal(isDelivered(p), false);
});

test("HHI e top 5 usam a mesma base de spend", () => {
  assert.equal(hhi([50, 50]), 5000);
  assert.equal(hhi([100]), 10000);
  assert.equal(topNShare([40, 30, 20, 10], 2), 0.7);
  assert.equal(topNShare([], 5), 0);
});

test("score: quatro pilares, pesos e arredondamento", () => {
  const s = supplierScore({
    deliveries: 10, otif: 0.8,
    received: 100, defects: 1,
    quotes: 5, competitiveness: 0.05,
    rating: 90, contractSpend: 50, spend: 100,
  });
  assert.equal(s.pillars, 4);
  assert.equal(s.prazoScore, 0.8);
  assert.equal(s.qualidade, 0.75);
  assert.equal(s.conformidade, 0.78);
  assert.equal(s.score, 74.0);
  assert.equal(supplierClassification(s.score), "Preferencial");
});

test("score: sem histórico de entrega não publica número artificial", () => {
  const s = supplierScore({
    deliveries: 0, otif: null, received: 0, defects: 0,
    quotes: 4, competitiveness: 0.03, rating: 85, contractSpend: 0, spend: 100,
  });
  assert.equal(s.pillars, 2);
  assert.equal(s.score, null);
  assert.equal(supplierClassification(null), "Sem histórico suficiente");
});

test("score: três pilares renormalizam os pesos disponíveis", () => {
  const s = supplierScore({
    deliveries: 4, otif: 0.9, received: 40, defects: 0,
    quotes: 0, competitiveness: null, rating: 100, contractSpend: 100, spend: 100,
  });
  assert.equal(s.pillars, 3);
  assert.equal(s.precoScore, null);
  assert.ok(s.score > 0 && s.score < 100);
  assert.equal(s.availableWeight, 0.75);
});

test("carteira contratual: vencido com pedido ativo gera alerta crítico", () => {
  const contracts = [
    { id_contrato: "CT-A", id_fornecedor: "F1", id_categoria: "K1", data_inicio: "2025-01-01", data_fim: "2026-01-01", valor_anual: 1000, reajuste_pct: 7, status: "Encerrado" },
    { id_contrato: "CT-B", id_fornecedor: "F2", id_categoria: "K1", data_inicio: "2026-01-01", data_fim: "2026-12-31", valor_anual: 2000, reajuste_pct: 3, status: "Vigente" },
  ];
  const pedidos = [
    { id_fornecedor: "F1", id_categoria: "K1", data_emissao: "2025-06-01", data_fim: "2026-01-01", valor_total: 300, status: "Entregue" },
    { id_fornecedor: "F1", id_categoria: "K1", data_emissao: "2026-02-01", valor_total: 400, status: "Atrasado" },
    { id_fornecedor: "F2", id_categoria: "K1", data_emissao: "2026-03-01", valor_total: 500, status: "Entregue" },
  ];
  const out = contractPortfolio(contracts, pedidos, "2026-10-31");
  const a = out.rows.find((r) => r.id_contrato === "CT-A");
  assert.equal(a.situacao, "Vencido");
  assert.equal(a.realizado, 300);
  assert.equal(a.exposicao, 400);
  assert.ok(a.alertas.some((x) => x.code === "VENCIDO_COM_PEDIDO" && x.level === "critical"));
  assert.equal(out.totals.vencidosComPedidoAtivo, 1);
  assert.ok(out.totals.alertasCriticos >= 1);
});

test("previsão: regressão linear projeta tendência e mantém banda não negativa", () => {
  const series = [100, 200, 300, 400, 500, 600].map((valor, i) => ({ mes: addMonths("2026-01", i), valor }));
  const lr = linearRegression(series.map((x) => x.valor));
  assert.equal(lr.slope, 100);
  const f = forecastSpend(series, { horizon: 3 });
  assert.equal(f.months.length, 3);
  assert.equal(f.months[0].mes, "2026-07");
  assert.equal(Math.round(f.months[0].valor), 700);
  assert.ok(f.months.every((m) => m.low >= 0 && m.high >= m.valor));
});

test("simulação de renegociação: economia incremental e nova taxa", () => {
  const s = simulateRenegotiation({ spend: 1_000_000, saving: 80_000, discountPct: 0.03, coveragePct: 0.5, volumeDeltaPct: 0 });
  assert.equal(s.eligible, 500_000);
  assert.equal(s.incremental, 15_000);
  assert.equal(s.newSaving, 55_000);
  assert.equal(s.newSpend, 985_000);
  assert.equal(s.newSavingRate, 55_000 / 985_000);
});

test("dataset: KPIs de referência permanecem estáveis", () => {
  const d = loadDataset();
  const valid = d.pedidos.filter(isValidSpend);
  const spend = valid.reduce((s, p) => s + p.valor_total, 0);
  const saving = valid.reduce((s, p) => s + p.saving_valor, 0);
  const delivered = valid.filter(isDelivered);
  const otif = delivered.reduce((s, p) => s + p.otif, 0) / delivered.length;
  const contractSpend = valid.filter((p) => p.tem_contrato === 1).reduce((s, p) => s + p.valor_total, 0);
  assert.ok(Math.abs(spend - 78_941_104) < 2, `spend ${spend}`);
  assert.ok(Math.abs(saving - 6_649_867) < 2, `saving ${saving}`);
  assert.ok(Math.abs(otif - 0.7862823) < 1e-6, `otif ${otif}`);
  assert.ok(Math.abs(contractSpend / spend - 0.6188717) < 1e-6, `cobertura ${contractSpend / spend}`);
});

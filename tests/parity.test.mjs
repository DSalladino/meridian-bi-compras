import test from "node:test";
import assert from "node:assert/strict";
import { loadDataset } from "../scripts/lib/dataset.mjs";
import { supplierScore, supplierClassification, isValidSpend, isDelivered } from "../app/js/kpi.js";
import { store, buildIndex, kpis, supplierScorecards, contractsOverview } from "../app/js/data.js";

const d = loadDataset();
store.dim = {
  unidades: d.unidades, compradores: d.compradores, categorias: d.categorias,
  itens: d.itens, fornecedores: d.fornecedores, contratos: d.contratos,
};
store.fato = { pedidos: d.pedidos, cotacoes: d.cotacoes, precos: d.precos, orcamento: d.orcamento };
buildIndex();

const months = [...new Set(store.fato.pedidos.map((p) => p.data_emissao.slice(0, 7)))].sort();

test("kpis do painel reconciliam com a regra pura", () => {
  const k = kpis(store.fato.pedidos, [], store.fato.orcamento, months, {});
  const valid = store.fato.pedidos.filter(isValidSpend);
  const delivered = valid.filter(isDelivered);
  const spend = valid.reduce((s, p) => s + p.valor_total, 0);
  const saving = valid.reduce((s, p) => s + p.saving_valor, 0);
  assert.equal(k.spend, spend);
  assert.equal(k.saving, saving);
  assert.equal(k.otif, delivered.reduce((s, p) => s + p.otif, 0) / delivered.length);
  assert.equal(k.contractShare, valid.filter((p) => p.tem_contrato === 1).reduce((s, p) => s + p.valor_total, 0) / spend);
  assert.ok(k.hhi > 0 && k.hhi <= 10000);
  assert.ok(k.top5Share > 0 && k.top5Share <= 1);
});

test("scorecard do painel usa exatamente supplierScore()", () => {
  const rows = supplierScorecards(store.fato.pedidos, store.fato.cotacoes);
  assert.ok(rows.length > 100);
  for (const row of rows) {
    const expected = supplierScore({
      deliveries: row.deliveries,
      otif: row.otif,
      received: row.received,
      defects: row.defects,
      quotes: row.quotes,
      competitiveness: row.competitiveness,
      rating: row.rating,
      contractSpend: row.contractSpend,
      spend: row.spend,
    });
    assert.equal(row.score, expected.score, row.nome);
    assert.equal(row.pillars, expected.pillars, row.nome);
    assert.equal(row.classification, supplierClassification(expected.score), row.nome);
  }
});

test("carteira contratual do painel reconcilia com contractPortfolio()", () => {
  const asOf = store.maxDate;
  const c = contractsOverview(asOf);
  assert.equal(c.totals.contratos, store.dim.contratos.length);
  assert.equal(c.rows.length, c.totals.contratos);
  assert.equal(c.totals.valorContratado, c.rows.reduce((s, r) => s + r.valor_anual, 0));
  assert.equal(c.totals.exposicao, c.rows.reduce((s, r) => s + r.exposicao, 0));
  assert.ok(["Vigente", "A vencer", "Vencido"].includes(c.rows[0].situacao));
  assert.equal(c.totals.alertasCriticos, c.alertas.filter((a) => a.level === "critical").length);
});

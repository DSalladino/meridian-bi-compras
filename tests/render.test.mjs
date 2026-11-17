import test from "node:test";
import assert from "node:assert/strict";
import { loadDataset } from "../scripts/lib/dataset.mjs";
import { store, buildIndex } from "../app/js/data.js";
import { barChart } from "../app/js/charts.js";

const d = loadDataset();
store.dim = {
  unidades: d.unidades, compradores: d.compradores, categorias: d.categorias,
  itens: d.itens, fornecedores: d.fornecedores, contratos: d.contratos,
};
store.fato = { pedidos: d.pedidos, cotacoes: d.cotacoes, precos: d.precos, orcamento: d.orcamento };
store.maxDate = "2026-10-31";
store.minDate = "2024-01-01";
buildIndex();

const elements = new Map();
const mk = (id) => ({ id, innerHTML: "", querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {} });
globalThis.document = {
  getElementById: (id) => {
    if (!elements.has(id)) elements.set(id, mk(id));
    return elements.get(id);
  },
  querySelector: () => null,
  querySelectorAll: () => [],
};

const { renderPage } = await import("../app/js/pages.js");

test("todas as páginas renderizam sem undefined/NaN", () => {
  for (const page of ["exec", "cotacoes", "fornecedores", "prazos", "precos", "contratos", "dados"]) {
    renderPage(page);
    const html = elements.get(`page-${page}`).innerHTML;
    assert.ok(html.length > 100, `${page} vazio`);
    assert.doesNotMatch(html, /undefined|NaN|\[object Object\]/, `${page} contém valor inválido`);
  }
});

test("gráfico de barras aceita rótulos que não são meses", () => {
  const svg = barChart({ labels: ["0 d", "1–2 d", "3–6 d"], series: [{ name: "Entregas", values: [10, 3, 1] }] });
  assert.match(svg, />0 d</);
  assert.match(svg, />1–2 d</);
  assert.doesNotMatch(svg, /undefined|NaN/);
});

test("páginas renderizam com base mínima: sem cotações, contratos, orçamento e item sem preço no mês", () => {
  store.fato.cotacoes = [];
  store.fato.orcamento = [];
  store.dim.contratos = [];

  // Mantém dois meses de preços e remove o mês mais recente de um item:
  // o item fica sem variação de 12 meses e não pode virar NaN no gráfico.
  const meses = [...new Set(store.fato.precos.map((p) => p.mes_ref))].sort();
  const ultimo = meses[meses.length - 1];
  const anterior = meses[meses.length - 2];
  const semPreco = store.fato.precos.find((p) => p.mes_ref === ultimo)?.id_item;
  store.fato.precos = store.fato.precos
    .filter((p) => p.mes_ref === ultimo || p.mes_ref === anterior)
    .filter((p) => !(p.id_item === semPreco && p.mes_ref === ultimo));

  buildIndex();
  for (const page of ["exec", "cotacoes", "fornecedores", "prazos", "precos", "contratos", "dados"]) {
    renderPage(page);
    const html = elements.get(`page-${page}`).innerHTML;
    assert.doesNotMatch(html, /undefined|NaN|\[object Object\]/, `base mínima: ${page}`);
  }
});

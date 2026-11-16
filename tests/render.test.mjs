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

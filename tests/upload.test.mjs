import test from "node:test";
import assert from "node:assert/strict";
import { loadDataset } from "../scripts/lib/dataset.mjs";
import { store, buildIndex } from "../app/js/data.js";
import { validateCSV, TEMPLATE_HEADER } from "../app/js/upload.js";

const d = loadDataset();
store.dim = {
  unidades: d.unidades, compradores: d.compradores, categorias: d.categorias,
  itens: d.itens, fornecedores: d.fornecedores, contratos: d.contratos,
};
store.fato = { pedidos: [], cotacoes: [], precos: [], orcamento: [] };
store.minDate = "2024-01-01";
store.maxDate = "2026-10-31";
buildIndex();

const fornecedor = store.dim.fornecedores[0];
const item = store.dim.itens[0];
const comprador = store.dim.compradores[0];
const unidade = store.dim.unidades[0];

function csv(rows) {
  return [TEMPLATE_HEADER.join(";"), ...rows.map((r) => TEMPLATE_HEADER.map((h) => r[h] ?? "").join(";"))].join("\n");
}

const validRow = {
  id_pedido: "PO-TEST-1", id_requisicao: "REQ-TEST-1", data_emissao: "2026-09-10",
  id_fornecedor: fornecedor.id_fornecedor, id_item: item.id_item, id_categoria: item.id_categoria,
  id_comprador: comprador.id_comprador, id_unidade: unidade.id_unidade,
  quantidade: 10, valor_unitario: 90, frete: 0, valor_total: 900, preco_referencia: 100,
  status: "Entregue", data_entrega_prevista: "2026-09-20", data_entrega_real: "2026-09-20",
  qtd_recebida: 10, qtd_defeito: 0, tem_contrato: 1,
};

test("upload válido deriva saving canônico e OTIF", () => {
  const v = validateCSV(csv([validRow]), "ok.csv");
  assert.deepEqual(v.errors, []);
  assert.equal(v.rows.length, 1);
  assert.equal(v.rows[0].saving_valor, 100);
  assert.equal(v.rows[0].otif, 1);
  assert.equal(v.rows[0].frete, 0);
});

test("upload rejeita FK inexistente e id duplicado", () => {
  const v = validateCSV(csv([
    { ...validRow, id_fornecedor: "F999" },
    { ...validRow, id_fornecedor: fornecedor.id_fornecedor },
  ]), "bad.csv");
  assert.ok(v.errors.some((e) => e.includes("fornecedor inexistente")));
  assert.ok(v.errors.some((e) => e.includes("duplicado")));
  assert.equal(v.rows.length, 1);
});

test("upload aceita saving negativo (sobrepreço) sem clampar", () => {
  const v = validateCSV(csv([{ ...validRow, id_pedido: "PO-TEST-2", valor_unitario: 110, valor_total: 1100 }]), "neg.csv");
  assert.deepEqual(v.errors, []);
  assert.equal(v.rows[0].saving_valor, -100);
});

test("upload valida cabeçalho obrigatório", () => {
  const v = validateCSV("id_pedido;data_emissao\nPO-1;2026-01-01", "missing.csv");
  assert.ok(v.errors.some((e) => e.includes("Colunas obrigatórias ausentes")));
});
